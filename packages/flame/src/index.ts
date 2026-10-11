import type { FlameConfig, Experiment, StoredAssignment, IdentityMetadata, Variant } from './types';
import type { UserContext } from './context';
import { ApiClient } from './api';
import { getOrCreateAssignment, getAssignedVariant, resolvePromotedWinner } from './assignment';
import {
  getIdentity,
  identify as identifyUser,
  clearIdentity,
  initSessionStart,
  getSessionStart,
  seedDeviceId,
  type Identity,
} from './identity';
import { collectContext } from './context';
import { applyVariant, rollbackChanges } from './apply';
import { TrackingManager } from './tracking';
import { getActiveEcommerceGoals } from './ecommerce';
import { parseDsn } from './dsn';

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
  private assignments: Map<string, StoredAssignment> = new Map();
  // Winners of promoted experiments this user sees. Applied to the DOM only:
  // never registered for tracking, since a concluded experiment's results
  // are frozen (flame#42).
  private promotedWinners: Variant[] = [];
  private initialized = false;
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

    try {
      if (config.prehydrated) {
        // Edge-resolved path: skip the active-experiments + assign
        // HTTP roundtrips and seed assignments directly. Used by the
        // React SDK's SSR flow with `@cuped-io/flame-edge`.
        this.experiments = config.prehydrated.experiments;
        this.log(`Using ${this.experiments.length} prehydrated experiments`);

        for (const experiment of this.experiments) {
          this.registerExperiment(experiment, config.prehydrated.assignments[experiment.id]);
        }
      } else {
        // Default path: fetch from the API.
        const response = await this.apiClient.getActiveExperiments();
        this.experiments = response.experiments;

        this.log(`Found ${this.experiments.length} active experiments`);

        // Build identity metadata for CUPED
        const identityMeta: IdentityMetadata = {
          type: this.identity.type,
          device_id: this.identity.deviceId,
          device_id_created_at: this.identity.deviceIdCreatedAt ?? undefined,
        };

        // Resolve assignments for all experiments concurrently — one parallel
        // batch instead of N serial round-trips, so a slow API no longer
        // compounds per experiment (flame#17). Order is preserved by
        // Promise.all, so registration below stays deterministic.
        // Hoist the flow-narrowed members into locals: inside the map callback
        // TS widens `this.userId`/`this.apiClient` back to their nullable
        // declared types, so capture the narrowed values here first.
        const userId = this.userId;
        const apiClient = this.apiClient;
        const context = this.context ?? undefined;
        // Promoted winners resolve in the same parallel batch. Settled, not
        // all-or-nothing (flame#35): one failing /assign used to reject the
        // whole batch, so no experiment applied and nothing was tracked.
        const [resolved, winners] = await Promise.all([
          Promise.allSettled(
            this.experiments.map((experiment) =>
              getOrCreateAssignment(experiment, userId, apiClient, context, identityMeta).then(
                (assignment) => ({ experiment, assignment })
              )
            )
          ),
          Promise.allSettled(
            (response.promoted ?? []).map((promoted) =>
              resolvePromotedWinner(promoted, userId, apiClient, context, identityMeta)
            )
          ),
        ]);

        resolved.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            this.registerExperiment(result.value.experiment, result.value.assignment);
          } else {
            // The visitor sees the original for this experiment only.
            console.warn(
              `[Flame] Assignment failed for experiment ${this.experiments[i].id}:`,
              result.reason
            );
          }
        });
        this.promotedWinners = winners.flatMap((result) => {
          if (result.status === 'rejected') {
            console.warn('[Flame] Promoted winner failed to resolve:', result.reason);
            return [];
          }
          return result.value ? [result.value] : [];
        });
        this.log(`Serving ${this.promotedWinners.length} promoted winners`);
      }

      // E-commerce auto-detection is opt-in (flame#38). Registered after the
      // assignments so the global goals carry them.
      const ecommerceGoals = this.config?.autoEcommerce ? getActiveEcommerceGoals() : [];
      if (ecommerceGoals.length > 0) {
        this.trackingManager.registerGlobalGoals(ecommerceGoals);
        this.log(`Detected ${ecommerceGoals.length} e-commerce goals on page`);
      }

      // Apply variants when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.applyAllVariants());
      } else {
        this.applyAllVariants();
      }

      // Start auto-tracking (includes event-based ecommerce tracking)
      this.trackingManager.startAutoTracking();

      // Flush events buffered before init ran (#20) — assignments are now
      // registered, so they carry the active experiment context.
      for (const event of this.pendingEvents) {
        this.trackingManager.track(event.eventType, event.metadata);
      }
      this.pendingEvents = [];

      // Track initial pageview
      this.trackingManager.trackPageview();

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
      this.assignments.set(experiment.id, assignment);
      this.trackingManager?.registerAssignment(assignment);
      this.log(`Assigned to variant ${assignment.variantId} for experiment ${experiment.id}`);
    } else {
      this.log(`No variant for experiment ${experiment.id} — rendering original`);
    }

    if (experiment.goals && experiment.goals.length > 0) {
      this.trackingManager?.registerGoals(experiment.id, experiment.goals);
    }
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
  private applyAllVariants(): void {
    const af = this.getAntiflicker();

    // Timeout already revealed the original → don't apply late (would flash).
    if (af?.revealed) return;

    // One variant's failure must not stop the others or the reveal (flame#35).
    const applySafely = (variant: Variant) => {
      try {
        applyVariant(variant, this.config?.debug);
      } catch (error) {
        console.warn(`[Flame] Failed to apply variant ${variant.id}:`, error);
      }
    };

    try {
      for (const experiment of this.experiments) {
        const assignment = this.assignments.get(experiment.id);
        if (!assignment) continue;

        const variant = getAssignedVariant(experiment, assignment);
        if (!variant) continue;

        applySafely(variant);
      }

      for (const winner of this.promotedWinners) {
        applySafely(winner);
      }
    } finally {
      af?.reveal();
    }
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
    if (!this.trackingManager) {
      // Fired before init() ran — buffer it and deliver once init sets up the
      // tracking manager (matches useTrack's documented behavior; #20). Prevents
      // silently dropping events that fire during early render.
      this.pendingEvents.push({ eventType, metadata });
      return;
    }

    this.trackingManager.track(eventType, metadata);
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
    rollbackChanges();
    this.trackingManager?.stopAutoTracking();
    this.assignments.clear();
    this.experiments = [];
    this.promotedWinners = [];
    this.initialized = false;
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
  flame.init({ dsn, debug, autoEcommerce });
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
