import type { FlameConfig, Experiment, StoredAssignment, IdentityMetadata, Variant } from './types';
import type { UserContext } from './context';
import { ApiClient } from './api';
import {
  resolveAssignments,
  getAssignedVariant,
  clearStoredAssignments,
  recordedArms,
  markRecorded,
} from './assignment';
import {
  getIdentity,
  identify as identifyUser,
  clearIdentity,
  initSessionStart,
  getSessionStart,
  seedDeviceId,
  clearStoredIdentity,
  type Identity,
} from './identity';
import { collectContext } from './context';
import { applyVariant, rollbackChanges } from './apply';
import { TrackingManager } from './tracking';
import { getActiveEcommerceGoals } from './ecommerce';
import { parseDsn } from './dsn';
import {
  HYDRATION_POLL_MS,
  HYDRATION_TIMEOUT_MS,
  reactSsrDetected,
  targetsHydrated,
} from './hydration';
import { watchForFreshTargets } from './reapply';
import { runsOnThisPage } from './url-pattern';
import { watchPathChanges } from './navigation';
import {
  initialConsentState,
  consentAllowsRunning,
  privacySignal,
  storeConsent,
  SIGNAL_OVERRIDES_CONSENT,
  type ConsentState,
} from './consent';

export type { ConsentState };

declare const __VERSION__: string;

/**
 * Main Flame SDK class
 */
class Flame {
  private config: FlameConfig | null = null;
  private apiClient: ApiClient | null = null;
  private trackingManager: TrackingManager | null = null;
  private userId: string | null = null;
  private identity: Identity | null = null;
  private context: UserContext | null = null;
  private experiments: Experiment[] = [];
  // Arms decided at init. Evaluated arms are registered (events carry them,
  // getVariant reports them) only when delivered (flame#46).
  private arms: Map<string, StoredAssignment> = new Map();
  // Delivered and registered arms.
  private assignments: Map<string, StoredAssignment> = new Map();
  // Winners of promoted experiments this user sees. Applied to the DOM only:
  // never registered for tracking, since a concluded experiment's results
  // are frozen (flame#42).
  private promotedWinners: Variant[] = [];
  private initialized = false;
  private consentStatus: ConsentState = 'not_required';
  private applyAfterReveal = false;
  private hydrationWaitStart: number | null = null;
  // Resolves start()'s wait once applyAllVariants has delivered or skipped.
  private onDeliveryDecided: (() => void) | null = null;
  // The live start(). A second call joins it instead of starting again, or
  // the first one's delivery wait would never resolve.
  private starting: Promise<void> | null = null;
  // Bumped by stopStart(). A start begun under an older generation stops at
  // its next await, so an answer arriving after the visitor withdrew, or the
  // SDK reset, changes nothing and records nothing.
  private generation = 0;
  private identityMeta: IdentityMetadata | null = null;
  private domWatcher: { stop: () => void } | null = null;
  private navigationWatcher: { stop: () => void } | null = null;
  // Experiments whose change is on the current page (flame#50): applied once
  // per page, undone when a client-side navigation leaves it.
  private appliedOnThisPage = new Set<string>();
  // Events fired via track() before init() ran — buffered here and flushed
  // once the tracking manager exists (useTrack pre-init buffering, #20).
  private pendingEvents: Array<{ eventType: string; metadata?: Record<string, unknown> }> = [];

  /**
   * Initialize the SDK with configuration
   */
  async init(config: FlameConfig): Promise<void> {
    if (this.initialized) {
      this.log('Already initialized');
      return;
    }

    this.config = config;

    // Parse the DSN and create client
    const parsed = parseDsn(config.dsn);
    this.apiClient = new ApiClient(parsed.apiKey, parsed.apiUrl, config.debug);
    this.log('Initialized', { apiUrl: parsed.apiUrl });

    // Before consent, nothing: no ID, no storage, no network (flame#18).
    // The rules (signals, a saved choice, the posture) live in consent.ts.
    this.consentStatus = initialConsentState(!!config.requireConsent);
    if (!consentAllowsRunning(this.consentStatus)) {
      this.log('Not running', { consent: this.consentStatus });
      this.getAntiflicker()?.reveal();
      return;
    }

    await this.start(config);
  }

  /**
   * Record the visitor's consent choice (flame#18). `true` starts flame on
   * the current page, applying the variant even though the original is
   * already showing, and saves the choice.
   */
  consent(granted: boolean): ConsentState {
    if (!granted) return this.withdraw();
    if (!this.config) return this.consentStatus;
    // Counsel-gated (flame#18), built "signal wins": a browser privacy
    // signal beats a site's explicit consent. Warn, so a suppressed accept is
    // not mistaken for a broken install.
    const signal = privacySignal();
    if (signal && SIGNAL_OVERRIDES_CONSENT) {
      console.warn(
        `[Flame] consent(true) ignored: the visitor's browser sends ${signal}, which keeps tracking off.`
      );
      this.consentStatus = 'blocked_by_signal';
      return this.consentStatus;
    }
    this.consentStatus = 'granted';
    storeConsent('granted');
    // 'next-page': the grant is saved; init starts flame on the next load.
    if (this.config.consentApply !== 'next-page') {
      void this.start(this.config, { afterReveal: true });
    }
    return this.consentStatus;
  }

  /**
   * Withdraw consent (flame#18). Fully synchronous, with no await, so no
   * unload or tab-hide flush can run part-way through. Sends nothing more:
   * the tracker's queue is dropped, not flushed, and its retry store
   * deleted. Then every stored identifier and the assignments cache go.
   * The page is left as it is: showing a variant is not tracking. Only the
   * refusal is kept, so later pages honour it. A request already sent
   * before this call cannot be recalled.
   */
  private withdraw(): ConsentState {
    // No more page changes after withdrawal, promoted winners included (#45).
    this.stopWatching();
    this.trackingManager?.discard();
    this.trackingManager = null;
    this.stopStart();
    this.pendingEvents = [];
    clearStoredIdentity();
    clearStoredAssignments();
    this.arms.clear();
    this.assignments.clear();
    this.appliedOnThisPage.clear();
    this.consentStatus = 'denied';
    storeConsent('denied');
    return this.consentStatus;
  }

  /**
   * Everything that needs consent: identity, tracking, assignment, apply.
   * `afterReveal`: started by consent on a page already showing the
   * original, so apply even though the anti-flicker hide has been lifted.
   */
  private start(config: FlameConfig, options: { afterReveal?: boolean } = {}): Promise<void> {
    this.starting ??= this.run(config, options);
    return this.starting;
  }

  private async run(config: FlameConfig, { afterReveal = false } = {}): Promise<void> {
    // init() creates the client before anything can call start().
    if (!this.apiClient) return;
    const generation = this.generation;
    const stopped = () => generation !== this.generation;
    this.applyAfterReveal = afterReveal;

    // Initialize session start time (for identity linking)
    initSessionStart();

    // If the caller pre-resolved state at the edge, align our
    // device id with the user_id used at resolution time. Must
    // happen before getIdentity() so the SDK reads the seeded
    // value as its own.
    if (config.prehydrated) {
      seedDeviceId(config.prehydrated.user_id, config.prehydrated.user_id_created_at);
    }

    // Get identity and context for CUPED support
    this.identity = getIdentity();
    this.userId = this.identity.userId;
    this.context = collectContext();

    this.trackingManager = new TrackingManager(this.apiClient, this.userId, {
      debug: config.debug,
      enableBatching: config.enableBatching,
      batchSize: config.batchSize,
      flushIntervalMs: config.flushIntervalMs,
      dsn: config.dsn,
      enableOfflineStorage: config.enableOfflineStorage,
      maxOfflineEvents: config.maxOfflineEvents,
      offlineTtlMs: config.offlineTtlMs,
    });

    this.log('Initializing Flame SDK', {
      version: __VERSION__,
      config,
      identityType: this.identity.type,
      deviceIdAge: this.identity.deviceIdAgeMs
        ? `${Math.round(this.identity.deviceIdAgeMs / (1000 * 60 * 60 * 24))} days`
        : 'new',
    });

    // Identity metadata for CUPED, sent with /evaluate and each record.
    const identityMeta: IdentityMetadata = {
      type: this.identity.type,
      device_id: this.identity.deviceId,
      device_id_created_at: this.identity.deviceIdCreatedAt ?? undefined,
    };
    this.identityMeta = identityMeta;

    try {
      // Either way nobody is enrolled yet: flame records each arm it delivers
      // (flame#46), the edge's arms included (flame#47).
      if (config.prehydrated) {
        // Edge-resolved path: skip the active-experiments + evaluate
        // HTTP roundtrips and seed the arms directly. Used by the
        // React SDK's SSR flow with `@cuped-io/flame-edge`.
        this.experiments = config.prehydrated.experiments;
        this.log(`Using ${this.experiments.length} prehydrated experiments`);

        for (const experiment of this.experiments) {
          this.registerExperiment(experiment, config.prehydrated.assignments[experiment.id]);
        }
      } else {
        // Default path: fetch from the API.
        const response = await this.apiClient.getActiveExperiments();
        if (stopped()) return;
        this.experiments = response.experiments;

        this.log(`Found ${this.experiments.length} active experiments`);

        // Every arm and promoted winner in one `/evaluate` (flame#46), which
        // enrols nobody. A failed evaluation renders the original for every
        // experiment without a cached arm, and does not fail init (flame#35).
        const { arms, winners } = await resolveAssignments(
          this.experiments,
          response.promoted ?? [],
          this.userId,
          this.apiClient,
          this.context ?? undefined,
          identityMeta
        );
        if (stopped()) return;
        for (const experiment of this.experiments) {
          this.registerExperiment(experiment, arms.get(experiment.id));
        }
        this.promotedWinners = winners;
        this.log(`Serving ${this.promotedWinners.length} promoted winners`);
      }

      // E-commerce auto-detection is opt-in (flame#38). Registered after the
      // assignments so the global goals carry them.
      const ecommerceGoals = this.config?.autoEcommerce ? getActiveEcommerceGoals() : [];
      if (ecommerceGoals.length > 0) {
        this.trackingManager.registerGlobalGoals(ecommerceGoals);
        this.log(`Detected ${ecommerceGoals.length} e-commerce goals on page`);
      }

      // Apply variants when DOM is ready. Nothing tagged with an arm goes out
      // before that arm's record (flame#46), so the buffered events and the
      // pageview wait for the delivery decision: applied, or skipped because
      // the anti-flicker timeout already revealed the original.
      const decided = new Promise<void>((resolve) => {
        this.onDeliveryDecided = resolve;
      });
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.applyAllVariants(generation));
      } else {
        this.applyAllVariants(generation);
      }

      // Start auto-tracking (includes event-based ecommerce tracking)
      this.trackingManager.startAutoTracking();

      // Flush events buffered before init ran (#20), then the initial
      // pageview. Once: after delivery, or when the visitor leaves first.
      let pageviewSent = false;
      const sendPageview = (tracker: TrackingManager) => {
        if (pageviewSent) return;
        pageviewSent = true;
        for (const event of this.pendingEvents) {
          tracker.track(event.eventType, event.metadata);
        }
        this.pendingEvents = [];
        tracker.trackPageview();
      };
      // A visitor who leaves before the decision never saw the variant, so
      // their pageview goes out now, with no arm, rather than not at all.
      // The queue's own pagehide flush has already run, so flush again.
      const onLeave = () => {
        if (!this.trackingManager) return;
        sendPageview(this.trackingManager);
        this.trackingManager.flush();
      };
      window.addEventListener('pagehide', onLeave);

      await decided;
      window.removeEventListener('pagehide', onLeave);
      // Consent may have been withdrawn, or the SDK reset, while waiting:
      // then send nothing.
      const tracker = this.trackingManager as TrackingManager | null;
      if (stopped() || !tracker) return;

      // Delivered arms are now registered, so these carry them.
      sendPageview(tracker);

      this.initialized = true;
      this.log('Flame SDK initialized successfully');
    } catch (error) {
      console.error('[Flame] Failed to initialize:', error);
      // Never leave an anti-flicker page hidden until its timeout (flame#35).
      this.getAntiflicker()?.reveal();
    }
  }

  /**
   * Register one experiment's assignment and goals with the tracker.
   *
   * No assignment means the user is in no variant — held out, the
   * workspace is capped or archived, or edge resolution skipped it. That
   * is a normal outcome: the page renders the original and events carry
   * no assignment for this experiment. Its goals still register, so a
   * held-out user's conversions reach the Holdout comparison.
   */
  private registerExperiment(
    experiment: Experiment,
    assignment: StoredAssignment | null | undefined
  ): void {
    // `variantId` is checked too: flame-edge cookies signed before it learned
    // to omit variant-less users carry `variantId: null`.
    if (assignment?.variantId) {
      // Events carry it only once it is delivered (flame#46).
      this.arms.set(experiment.id, assignment);
      this.log(`Assigned to variant ${assignment.variantId} for experiment ${experiment.id}`);
    } else {
      this.log(`No variant for experiment ${experiment.id} — rendering original`);
    }

    if (experiment.goals && experiment.goals.length > 0) {
      this.trackingManager?.registerGoals(experiment.id, experiment.goals);
    }
  }

  /**
   * Stop the live start, if any: it returns at its next await instead of
   * applying, recording or sending. Its delivery wait is released here, since
   * its applyAllVariants will now return before deciding.
   */
  private stopStart(): void {
    this.generation++;
    this.starting = null;
    this.deliveryDecided();
  }

  /** Lets start() send what waited for the delivery decision. Once. */
  private deliveryDecided(): void {
    const resolve = this.onDeliveryDecided;
    this.onDeliveryDecided = null;
    resolve?.();
  }

  /** Events carry this arm from now on, and getVariant reports it. */
  private registerAssignment(assignment: StoredAssignment): void {
    this.assignments.set(assignment.experimentId, assignment);
    this.trackingManager?.registerAssignment(assignment);
  }

  /**
   * Apply all assigned variants to the DOM, then reveal the page.
   *
   * Anti-flicker (flame#16): an inline snippet hides the page until we
   * reveal it, so the control never flashes before the variant applies.
   * We reveal here — the moment variants are on — which beats the snippet's
   * timeout on the happy path. If the timeout already fired (slow API, page
   * already revealed showing the original), we skip applying: a late DOM
   * swap on an already-visible page would itself be a flash, so those
   * visitors stay on control. No-op when no anti-flicker snippet is present.
   */
  private applyAllVariants(generation: number): void {
    // Withdrawn or reset since this start began: withdraw() and reset() have
    // already released its delivery wait, so only stop.
    if (generation !== this.generation) return;
    const af = this.getAntiflicker();

    // Timeout already revealed the original → don't apply late (would flash).
    // Except after consent, where applying on the visible page is the design.
    if (af?.revealed && !this.applyAfterReveal) {
      this.deliveryDecided();
      // A later client-side navigation renders a new page, so it may deliver.
      this.watchNavigation();
      return;
    }

    // On a server-rendered React page, wait until React has hydrated every
    // target element, or React throws #418 and discards the variant (#44).
    if (this.shouldWaitForHydration() && !targetsHydrated(this.targetSelectors())) {
      this.hydrationWaitStart ??= Date.now();
      if (Date.now() - this.hydrationWaitStart < HYDRATION_TIMEOUT_MS) {
        setTimeout(() => this.applyAllVariants(generation), HYDRATION_POLL_MS);
        return;
      }
      this.log('React did not hydrate the targets in time; applying anyway');
    }

    try {
      this.deliverArms();
      for (const winner of this.promotedWinners) {
        this.applySafely(winner);
      }
    } finally {
      af?.reveal();
      this.deliveryDecided();
    }

    this.watchForFreshTargets();
    this.watchNavigation();
  }

  /**
   * Deliver each arm whose experiment runs on the current page: record it if
   * this user's arm was never recorded, register it, and apply it once per
   * page load. Runs at init and on each client-side navigation (flame#50).
   */
  private deliverArms(): void {
    const wasRecorded = recordedArms();
    const userId = this.userId ?? '';
    for (const experiment of this.experiments) {
      const assignment = this.arms.get(experiment.id);
      if (!assignment) continue;

      const variant = getAssignedVariant(experiment, assignment);
      if (!variant) continue;
      // Not this page's experiment (flame#50): the visitor is not assigned
      // here. One already counted on a matching page still carries the arm,
      // so a conversion here is attributed, but sees no change.
      if (!runsOnThisPage(experiment)) {
        if (wasRecorded(experiment.id, userId, variant.id)) this.registerAssignment(assignment);
        continue;
      }

      // Delivered: count the visitor in this arm (flame#46). Recorded at the
      // decision to apply, not on a DOM change, so control (no changes) and
      // a variant whose change fails are counted the same way.
      // Recorded before it is registered, so no event carries an arm ember
      // has not been told about.
      if (!wasRecorded(experiment.id, userId, variant.id)) {
        // Marked only once the record is sent; until then each page load
        // records again, and ember ignores the duplicates.
        const queued = this.trackingManager?.recordAssignment(
          experiment.id,
          variant.id,
          {
            context: (this.context ?? undefined) as Record<string, unknown> | undefined,
            identity: this.identityMeta ?? undefined,
            path: window.location.pathname,
          },
          () => markRecorded({ ...assignment, userId })
        );
        // An arm flame cannot record is not delivered: the visitor sees
        // the original, as when the anti-flicker timeout wins.
        if (!queued) continue;
      }
      this.registerAssignment(assignment);
      // Once per page: a target re-created later is the watcher's (#45).
      if (this.appliedOnThisPage.has(experiment.id)) continue;
      this.appliedOnThisPage.add(experiment.id);
      this.applySafely(variant);
    }
  }

  /** One variant's failure must not stop the others or the reveal (flame#35). */
  private applySafely(variant: Variant): void {
    try {
      applyVariant(variant, this.config?.debug);
    } catch (error) {
      console.warn(`[Flame] Failed to apply variant ${variant.id}:`, error);
    }
  }

  /**
   * A single-page app changes its URL without a page load: deliver the arms
   * of experiments that now match (flame#50). Only when an experiment has a
   * pattern, so other sites' history is left alone.
   */
  private watchNavigation(): void {
    if (this.navigationWatcher || typeof window === 'undefined') return;
    if (!this.experiments.some((e) => e.url_pattern)) return;
    this.navigationWatcher = watchPathChanges(() => this.onPathChange());
  }

  /**
   * The page changed without a load. An experiment that stops matching has
   * its change undone, on whatever the app kept on screen; flame can only
   * roll back everything, so the rest is applied again, without redirects,
   * which have already happened. Then this page's arms are delivered.
   */
  private onPathChange(): void {
    const leaving = this.experiments.filter(
      (e) => this.appliedOnThisPage.has(e.id) && !runsOnThisPage(e)
    );
    if (leaving.length > 0) {
      rollbackChanges();
      for (const experiment of leaving) this.appliedOnThisPage.delete(experiment.id);
      const reapply = (variant: Variant) =>
        this.applySafely({
          ...variant,
          changes: variant.changes?.filter((c) => c.type !== 'redirect'),
        });
      for (const experiment of this.experiments) {
        const arm =
          this.appliedOnThisPage.has(experiment.id) && this.assignments.get(experiment.id);
        const variant = arm && getAssignedVariant(experiment, arm);
        if (variant) reapply(variant);
      }
      this.promotedWinners.forEach(reapply);
    }
    this.deliverArms();
    // An app often routes first and renders after: the watcher catches the
    // targets that appear once it does (flame#45).
    this.watchForFreshTargets();
  }

  /**
   * After the first apply, re-apply a variant when one of its targets appears
   * without flame's data-flame-modified marker: a framework re-created it (a
   * remount, client-side navigation away and back), so it lost the variant
   * (flame#45).
   */
  private watchForFreshTargets(): void {
    if (this.config?.reapplyOnChange === false) return;
    if (this.domWatcher || typeof MutationObserver === 'undefined') return;
    this.domWatcher = watchForFreshTargets(() => this.activeVariants(), this.config?.debug);
  }

  /** No more page changes: neither re-applies nor navigation deliveries. */
  private stopWatching(): void {
    this.domWatcher?.stop();
    this.domWatcher = null;
    this.navigationWatcher?.stop();
    this.navigationWatcher = null;
  }

  /** The opt-in when set; otherwise whether the page is React SSR. */
  private shouldWaitForHydration(): boolean {
    return this.config?.waitForHydration ?? reactSsrDetected();
  }

  /** The variants of these arms on this page (flame#50), plus the promoted winners. */
  private variantsOf(arms: Map<string, StoredAssignment>): Variant[] {
    return [
      ...this.experiments.flatMap((experiment) => {
        const arm = arms.get(experiment.id);
        const variant = arm && runsOnThisPage(experiment) && getAssignedVariant(experiment, arm);
        return variant ? [variant] : [];
      }),
      ...this.promotedWinners,
    ];
  }

  /** The assigned variants and promoted winners this visitor sees. */
  private activeVariants(): Variant[] {
    return this.variantsOf(this.assignments);
  }

  /** The selectors the arms about to be delivered and promoted winners change. */
  private targetSelectors(): string[] {
    return this.variantsOf(this.arms).flatMap((v) =>
      (v.changes ?? []).flatMap((c) => ('selector' in c ? [c.selector] : []))
    );
  }

  /** The page's anti-flicker handle, if the inline snippet installed one. */
  private getAntiflicker(): { revealed: boolean; reveal: () => void } | undefined {
    if (typeof window === 'undefined') return undefined;
    return (window as unknown as { __cupedAntiflicker?: { revealed: boolean; reveal: () => void } })
      .__cupedAntiflicker;
  }

  /**
   * Track an event
   *
   * Fires one event per user action with the active experiment
   * assignments attached for server-side goal matching. For SPA
   * navigation call `track('pageview')` when the URL changes; for
   * conversions call `track('conversion', …)`.
   *
   * @param eventType - Type of event (pageview, add_to_cart, conversion, etc.)
   * @param metadata - Optional metadata for event-specific data
   */
  track(eventType: string, metadata?: Record<string, unknown>): void {
    // Before consent nothing counts, not even later (flame#18).
    if (!consentAllowsRunning(this.consentStatus)) return;
    if (!this.trackingManager) {
      // Fired before init() ran — buffer it and deliver once init sets up the
      // tracking manager (matches useTrack's documented behavior; #20). Prevents
      // silently dropping events that fire during early render.
      this.pendingEvents.push({ eventType, metadata });
      return;
    }

    this.trackingManager.track(eventType, metadata);
  }

  /** Where flame stands on the visitor's consent (flame#18). */
  consentState(): ConsentState {
    return this.consentStatus;
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Get the full identity information
   *
   * Returns metadata about identity stability for CUPED eligibility.
   */
  getIdentity(): Identity | null {
    return this.identity;
  }

  /**
   * Set the authenticated user ID
   *
   * Call this when a user logs in to enable:
   * - Cross-device experiment consistency
   * - More reliable CUPED analysis
   * - Better user journey tracking
   *
   * @param userId - The authenticated user ID from your system
   */
  async identify(userId: string): Promise<void> {
    // Get device ID before updating identity
    const previousIdentity = this.identity ?? getIdentity();
    const deviceId = previousIdentity.deviceId;

    identifyUser(userId);

    // Update local state
    this.identity = getIdentity();
    this.userId = this.identity.userId;

    // Same tracker, new user (flame#36). Rebuilding it here left the old
    // one's listeners firing under the device ID, never started the new
    // one's, and dropped the e-commerce goals.
    this.trackingManager?.setUserId(this.userId);

    // Link the authenticated user to their device ID for CUPED
    // This allows the backend to find pre-period events from before authentication
    if (this.apiClient && deviceId !== userId) {
      try {
        await this.apiClient.linkIdentity(
          userId,
          deviceId,
          'device',
          getSessionStart() ?? undefined
        );
        this.log('Identity linked', { canonicalUserId: userId, deviceId });
      } catch (error) {
        // Don't fail identify() if linking fails - it's an optimization
        this.log('Failed to link identity (non-fatal):', error);
      }
    }

    this.log('User identified', { userId, identityType: this.identity.type });
  }

  /**
   * Clear the authenticated user ID (on logout)
   *
   * Reverts to device-based identity.
   */
  clearIdentity(): void {
    clearIdentity();

    // Update local state
    this.identity = getIdentity();
    this.userId = this.identity.userId;
    // Events after logout carry the device ID again (flame#36).
    this.trackingManager?.setUserId(this.userId);

    this.log('Identity cleared', { identityType: this.identity.type });
  }

  /**
   * Get the assigned variant ID for an experiment.
   *
   * Returns the variant UUID, or `null` if the user is not assigned
   * (experiment unknown, init not finished, etc.). For richer variant
   * info — name, is_control, the configured changes — use
   * `getAssignedVariantInfo(experimentId)` instead.
   */
  getVariant(experimentId: string): string | null {
    const assignment = this.assignments.get(experimentId);
    return assignment?.variantId ?? null;
  }

  /**
   * Get the assigned variant object for an experiment.
   *
   * Returns the full {@link Variant} (id, name, is_control, changes)
   * when the user is assigned and the experiment is known to the
   * SDK; `null` otherwise. The React SDK uses this for the
   * `useExperiment` hook so callers can branch on variant *name*
   * rather than UUID.
   */
  getAssignedVariantInfo(experimentId: string): Variant | null {
    const assignment = this.assignments.get(experimentId);
    if (!assignment) return null;
    const experiment = this.experiments.find((e) => e.id === experimentId);
    if (!experiment) return null;
    return getAssignedVariant(experiment, assignment) ?? null;
  }

  /**
   * Check if a user is in a specific variant.
   *
   * Accepts either the variant UUID (compares against the
   * assignment's variantId) or — for ergonomics — the variant name
   * (looks up the experiment and compares names).
   */
  isInVariant(experimentId: string, variantOrName: string): boolean {
    if (this.getVariant(experimentId) === variantOrName) return true;
    const info = this.getAssignedVariantInfo(experimentId);
    return info?.name === variantOrName;
  }

  /**
   * Whether the SDK has finished initializing.
   *
   * `true` once `init()` has resolved (experiments fetched,
   * assignments resolved). The React provider uses this to gate
   * `useExperiment`'s `isLoading` flag.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset all assignments and rollback changes
   */
  reset(): void {
    this.stopWatching();
    rollbackChanges();
    this.trackingManager?.stopAutoTracking();
    this.arms.clear();
    this.assignments.clear();
    this.appliedOnThisPage.clear();
    this.experiments = [];
    this.promotedWinners = [];
    this.initialized = false;
    this.stopStart();
    this.log('Flame SDK reset');
  }

  private log(...args: unknown[]): void {
    if (this.config?.debug) {
      console.log('[Flame]', ...args);
    }
  }
}

// Create singleton instance
const flame = new Flame();

// Auto-initialize from script data attributes.
//
// SSR-safe: returns early when `document` is undefined, so the
// module is importable from Node.js (used by `@cuped-io/flame-react`
// running under Next.js / Remix / TanStack Start server bundles).
function autoInit(): void {
  if (typeof document === 'undefined') return;

  // Find the script tag
  const script = document.currentScript as HTMLScriptElement | null;
  const scriptElement = script || document.querySelector('script[data-dsn]');

  if (!scriptElement) return;

  const dsn = scriptElement.getAttribute('data-dsn');
  if (!dsn) return;

  const debug = scriptElement.getAttribute('data-debug') === 'true';
  const autoEcommerce = scriptElement.getAttribute('data-ecommerce') === 'true';
  const requireConsent = scriptElement.getAttribute('data-consent') === 'required';
  const consentApply =
    scriptElement.getAttribute('data-consent-apply') === 'next-page' ? 'next-page' : 'immediate';
  // Absent: auto-detect React SSR frameworks. "true"/"false": force (#44).
  const hydrationAttr = scriptElement.getAttribute('data-wait-for-hydration');
  const waitForHydration =
    hydrationAttr === 'true' ? true : hydrationAttr === 'false' ? false : undefined;
  const reapplyOnChange = scriptElement.getAttribute('data-reapply') !== 'false';
  flame.init({
    dsn,
    debug,
    autoEcommerce,
    requireConsent,
    consentApply,
    waitForHydration,
    reapplyOnChange,
  });
}

// Run auto-init
autoInit();

// Export for manual use
export { flame, Flame };
export type {
  FlameConfig,
  PrehydratedState,
  Experiment,
  PromotedExperiment,
  Variant,
  VariantChange,
  TextChange,
  HtmlChange,
  AttributeChange,
  ClassChange,
  StyleChange,
  CssChange,
  VisibilityChange,
  RedirectChange,
  StoredAssignment,
  StoredAssignment as Assignment,
  Goal,
  GoalType,
  IdentityType,
  AliasType,
  ExperimentAssignment,
  Resolution,
  CreateEventRequest,
  CreateEventBatchRequest,
  EventResponse,
} from './types';
export { EventQueue, DEFAULT_BATCH_SIZE, DEFAULT_FLUSH_INTERVAL_MS } from './queue';
export type { EventQueueConfig } from './queue';
export type { Identity } from './identity';
export type { UserContext, DeviceType, ViewportBucket, ConnectionType } from './context';
export { getEcommerceGoals, getActiveEcommerceGoals } from './ecommerce';
export { parseDsn } from './dsn';
export { collectContext, collectMinimalContext } from './context';
export { hasPrePeriodEligibility } from './identity';

// Expose on window for script tag usage
if (typeof window !== 'undefined') {
  (window as unknown as { flame: typeof flame }).flame = flame;
}
