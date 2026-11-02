import type {
  FlameConfig,
  IdentityMetadata,
  PrehydratedState,
  StoredAssignment,
  Variant,
} from './types';
import type { UserContext } from './context';
import { ApiClient } from './api';
import { savedArms, clearStoredAssignments, recordedArms, markRecorded } from './assignment';
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
import { TrackingManager } from './tracking';
import { parseDsn } from './dsn';
import { runsOnThisPage } from './url-pattern';
import {
  pickArms,
  parseRules,
  loadStoredRules,
  storeRules,
  clearStoredRules,
  type Arm,
  type RulesFile,
} from './rules';
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
 * Dispatched on `window` each time flame's reads start answering: when init
 * completes, and again when a consent grant starts flame (flame#24).
 */
export const READY_EVENT = 'flame:ready';

/** The arms a flame-edge answer gives, and control for what it left out. */
function edgeArms(prehydrated: PrehydratedState): Arm[] {
  return prehydrated.experiments.flatMap((experiment) => {
    const variants = experiment.variants ?? [];
    const control = variants.find((v) => v.is_control) ?? null;
    // `variantId` is checked: flame-edge cookies signed before it learned to
    // omit variant-less users carry `variantId: null`.
    const variantId = prehydrated.assignments[experiment.id]?.variantId;
    const assigned = variantId ? variants.find((v) => v.id === variantId) : undefined;
    // Left out: held out, capped or archived. They see control, unrecorded.
    const variant = assigned ?? control;
    if (!variant) return [];
    return [
      {
        experimentId: experiment.id,
        slug: experiment.slug ?? experiment.id,
        urlPattern: experiment.url_pattern ?? null,
        variant,
        control,
        exposure: !!assigned,
      },
    ];
  });
}

/**
 * Main Flame SDK class
 */
class Flame {
  private config: FlameConfig | null = null;
  private apiClient: ApiClient | null = null;
  private apiKey = '';
  private trackingManager: TrackingManager | null = null;
  private userId: string | null = null;
  private identity: Identity | null = null;
  private context: UserContext | null = null;
  // The rules file the arms were picked from. None for a flame-edge answer.
  private rules: RulesFile | null = null;
  // This visitor's answer for every experiment flame knows (flame#24).
  private arms: Arm[] = [];
  // Arms read and recorded on this page view, by experiment id. A later read
  // returns the same variant, even after a refreshed rules file or identify().
  private exposed: Map<string, Variant> = new Map();
  private initialized = false;
  private readyPromise!: Promise<void>;
  private resolveReady!: () => void;
  private consentStatus: ConsentState = 'not_required';
  // The live start(). A second call joins it instead of starting again.
  private starting: Promise<void> | null = null;
  // Bumped by stopStart(). A start begun under an older generation stops at
  // its next await, so an answer arriving after the visitor withdrew, or the
  // SDK reset, changes nothing and records nothing.
  private generation = 0;
  private identityMeta: IdentityMetadata | null = null;
  // Events fired via track() before init() ran — buffered here and flushed
  // once the tracking manager exists (useTrack pre-init buffering, #20).
  private pendingEvents: Array<{ eventType: string; metadata?: Record<string, unknown> }> = [];

  constructor() {
    this.newReadyPromise();
  }

  /**
   * Resolves when init completes and reads answer: with the visitor's arms,
   * or with control when flame cannot run or has no rules file (flame#24).
   * Page code awaits this instead of polling `isInitialized()`. The same
   * moment dispatches {@link READY_EVENT} on `window`.
   */
  get ready(): Promise<void> {
    return this.readyPromise;
  }

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
    this.apiKey = parsed.apiKey;
    this.apiClient = new ApiClient(
      parsed.apiKey,
      parsed.apiUrl,
      config.debug,
      config.requestTimeoutMs
    );
    this.log('Initialized', { apiUrl: parsed.apiUrl });

    // Before consent, nothing: no ID, no storage, no network (flame#18).
    // The rules (signals, a saved choice, the posture) live in consent.ts.
    // Reads answer control.
    this.consentStatus = initialConsentState(!!config.requireConsent);
    if (!consentAllowsRunning(this.consentStatus)) {
      this.log('Not running', { consent: this.consentStatus });
      this.settle();
      return;
    }

    await this.start(config);
  }

  /**
   * Record the visitor's consent choice (flame#18). `true` starts flame on
   * the current page and saves the choice.
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
      void this.start(this.config);
    }
    return this.consentStatus;
  }

  /**
   * Withdraw consent (flame#18). Fully synchronous, with no await, so no
   * unload or tab-hide flush can run part-way through. Sends nothing more:
   * the tracker's queue is dropped, not flushed, and its retry store
   * deleted. Then every stored identifier, the assignments cache and the
   * stored rules file go.
   * Reads answer control from now on. Only the refusal is kept, so later
   * pages honour it. A request already sent before this call cannot be
   * recalled.
   */
  private withdraw(): ConsentState {
    this.trackingManager?.discard();
    this.trackingManager = null;
    this.stopStart();
    this.pendingEvents = [];
    clearStoredIdentity();
    clearStoredAssignments();
    clearStoredRules(this.apiKey);
    this.rules = null;
    this.arms = [];
    this.exposed.clear();
    this.consentStatus = 'denied';
    storeConsent('denied');
    return this.consentStatus;
  }

  /** Everything that needs consent: identity, tracking, the arms. */
  private start(config: FlameConfig): Promise<void> {
    this.starting ??= this.run(config);
    return this.starting;
  }

  private async run(config: FlameConfig): Promise<void> {
    // init() creates the client before anything can call start().
    if (!this.apiClient) return;
    const generation = this.generation;
    const stopped = () => generation !== this.generation;

    // Initialize session start time (for identity linking)
    initSessionStart();

    // A flame-edge answer was picked for its user_id: make it this device's
    // id. Must happen before getIdentity() reads it.
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

    // Identity metadata for CUPED, sent with each record.
    this.identityMeta = {
      type: this.identity.type,
      device_id: this.identity.deviceId,
      device_id_created_at: this.identity.deviceIdCreatedAt ?? undefined,
    };

    // The pageview goes out now, with no wait on the network. It carries
    // the arms recorded on earlier visits whose experiments still run.
    const stored = config.prehydrated ? null : loadStoredRules(this.apiKey);
    this.carryRecordedArms(stored);
    for (const event of this.pendingEvents) {
      this.trackingManager.track(event.eventType, event.metadata);
    }
    this.pendingEvents = [];
    this.trackingManager.trackPageview();

    try {
      if (config.prehydrated) {
        // flame-edge picked the arms on the server: nothing to fetch.
        this.arms = edgeArms(config.prehydrated);
      } else {
        // A stored copy is used at once and refreshed in the background;
        // with none, the arms wait for the fetch.
        const fetched = this.fetchRules(stopped);
        const rules = stored ?? (await fetched);
        if (stopped()) return;
        if (rules) await this.pick(rules, stopped);
        if (stored) {
          void fetched.then((fresh) => {
            if (fresh && !stopped()) return this.pick(fresh, stopped);
          });
        }
      }
    } catch (error) {
      console.error('[Flame] Failed to initialize:', error);
    }
    if (stopped()) return;
    this.log(`Answering for ${this.arms.length} experiments`);
    this.settle();
  }

  /**
   * The rules file from ember (ember#309), kept for the next load. `null`
   * when it cannot be fetched or read: reads then answer control.
   */
  private async fetchRules(stopped: () => boolean): Promise<RulesFile | null> {
    try {
      const rules = parseRules(await this.apiClient?.getRules());
      if (!rules) {
        console.warn('[Flame] The rules file is not a version this flame reads; showing control.');
        return null;
      }
      if (!stopped()) storeRules(this.apiKey, rules);
      return rules;
    } catch (error) {
      this.log('Rules file unavailable:', error);
      return null;
    }
  }

  /**
   * This visitor's arms from `rules`, unless the start was stopped meanwhile.
   * If identify() or clearIdentity() changed the user while hashing, the
   * arms are for the wrong user: pick again for the current one.
   */
  private async pick(rules: RulesFile, stopped: () => boolean): Promise<void> {
    const userId = this.userId ?? '';
    const arms = await pickArms(rules, userId, savedArms());
    if (stopped()) return;
    if (userId !== (this.userId ?? '')) return this.pick(rules, stopped);
    this.rules = rules;
    this.arms = arms;
  }

  /**
   * Register the arms this visitor had recorded on an earlier visit, so
   * events carry them before any read. Only for experiments the stored
   * rules file lists, with the same variant.
   */
  private carryRecordedArms(rules: RulesFile | null): void {
    if (!rules) return;
    const userId = this.userId ?? '';
    const saved = savedArms();
    const wasRecorded = recordedArms();
    for (const experiment of rules.experiments) {
      const arm = saved[experiment.id];
      if (
        arm?.userId === userId &&
        experiment.variants.some((v) => v.id === arm.variantId) &&
        wasRecorded(experiment.id, userId, arm.variantId)
      ) {
        this.trackingManager?.registerAssignment(arm);
      }
    }
  }

  /** Init is done: reads answer, and page code waiting on ready hears it. */
  private settle(): void {
    this.initialized = true;
    this.resolveReady();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(READY_EVENT));
    this.log('Flame SDK initialized successfully');
  }

  private newReadyPromise(): void {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  /** Stop the live start, if any: it returns at its next await. */
  private stopStart(): void {
    this.generation++;
    this.starting = null;
  }

  /**
   * The variant to show for `key` (an experiment's id or slug), recording
   * the arm on its first read (flame#24). Records nothing, and answers
   * control or `null`, when flame is not ready, the visitor is held out,
   * or the experiment does not run on this page.
   */
  private read(key: string): Variant | null {
    if (!this.initialized) return null;
    const arm = this.arms.find((a) => a.experimentId === key || a.slug === key);
    if (!arm) return null;
    const exposed = this.exposed.get(arm.experimentId);
    if (exposed) return exposed;

    const here = runsOnThisPage({ url_pattern: arm.urlPattern });
    if (!arm.exposure) return here ? arm.variant : arm.control;

    const userId = this.userId ?? '';
    const assignment: StoredAssignment = {
      experimentId: arm.experimentId,
      variantId: arm.variant.id,
      userId,
      assignedAt: new Date().toISOString(),
    };
    // Recorded on an earlier visit: carried again, wherever it is read.
    if (!recordedArms()(arm.experimentId, userId, arm.variant.id)) {
      // Not this page's experiment (flame#50): the visitor is not assigned
      // here, and ember would refuse the record.
      if (!here) return arm.control;
      // Marked only once the record is sent; until then each page load
      // records again, and ember ignores the duplicates.
      const queued = this.trackingManager?.recordAssignment(
        arm.experimentId,
        arm.variant.id,
        {
          context: (this.context ?? undefined) as Record<string, unknown> | undefined,
          identity: this.identityMeta ?? undefined,
          path: window.location.pathname,
        },
        () => markRecorded(assignment)
      );
      // An arm flame cannot record is not shown.
      if (!queued) return arm.control;
    }
    // Recorded before it is registered, so no event carries an arm ember
    // has not been told about.
    this.exposed.set(arm.experimentId, arm.variant);
    this.trackingManager?.registerAssignment(assignment);
    return arm.variant;
  }

  /** Pick again for a new user id, once identify() or clearIdentity() changed it. */
  private async repick(): Promise<void> {
    if (!this.rules) return;
    const generation = this.generation;
    await this.pick(this.rules, () => generation !== this.generation);
  }

  /**
   * Track an event
   *
   * Fires one event per user action, carrying the arms recorded so far
   * for server-side goal matching. For SPA navigation call
   * `track('pageview')` when the URL changes; for conversions call
   * `track('conversion', …)`.
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
   * Arms not yet read on this page are picked again for the new ID.
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
    // one's listeners firing under the device ID and never started the new
    // one's.
    this.trackingManager?.setUserId(this.userId);
    await this.repick();

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
    void this.repick();

    this.log('Identity cleared', { identityType: this.identity.type });
  }

  /**
   * The variant ID to show for an experiment, by its id or slug.
   *
   * Answers at once. The first read of the visitor's real arm records it
   * (flame#24): an experiment the page never reads is never recorded.
   * Returns control's ID for a Holdout member or a page outside the
   * experiment's pattern, and `null` when flame is not ready or does not
   * know the experiment: show control then. For the name and the rest of
   * the variant, use `getAssignedVariantInfo(key)`.
   */
  getVariant(key: string): string | null {
    return this.read(key)?.id ?? null;
  }

  /**
   * The variant to show for an experiment, by its id or slug: id, name,
   * `is_control`. A read like {@link getVariant}, and `null` when it is.
   * The React SDK uses this for `useExperiment`, so callers can branch on
   * the variant's name.
   */
  getAssignedVariantInfo(key: string): Variant | null {
    return this.read(key);
  }

  /**
   * Whether the visitor sees this variant, given its UUID or its name. A
   * read like {@link getVariant}.
   */
  isInVariant(key: string, variantOrName: string): boolean {
    const variant = this.read(key);
    return variant?.id === variantOrName || variant?.name === variantOrName;
  }

  /**
   * Whether init has completed and reads answer. Await {@link ready}
   * instead of polling this.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Forget every arm and stop: reads answer `null` until the next init.
   */
  reset(): void {
    this.trackingManager?.stop();
    this.arms = [];
    this.rules = null;
    this.exposed.clear();
    if (this.initialized) this.newReadyPromise();
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
  const requireConsent = scriptElement.getAttribute('data-consent') === 'required';
  const consentApply =
    scriptElement.getAttribute('data-consent-apply') === 'next-page' ? 'next-page' : 'immediate';
  flame.init({ dsn, debug, requireConsent, consentApply });
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
export { parseDsn } from './dsn';
export { collectContext, collectMinimalContext } from './context';
export { hasPrePeriodEligibility } from './identity';

// Expose on window for script tag usage
if (typeof window !== 'undefined') {
  (window as unknown as { flame: typeof flame }).flame = flame;
}
