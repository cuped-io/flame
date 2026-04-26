import type { FlameConfig, Experiment, StoredAssignment, IdentityMetadata, Variant } from './types';
import type { UserContext } from './context';
import { ApiClient } from './api';
import { getOrCreateAssignment, getAssignedVariant } from './assignment';
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
  private initialized = false;

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
          const assignment = config.prehydrated.assignments[experiment.id];
          if (!assignment) {
            this.log(`No prehydrated assignment for ${experiment.id} — skipping`);
            continue;
          }
          this.assignments.set(experiment.id, assignment);
          this.trackingManager.registerAssignment(assignment);

          this.log(`Prehydrated assignment ${assignment.variantId} for experiment ${experiment.id}`);

          if (experiment.goals && experiment.goals.length > 0) {
            this.trackingManager.registerGoals(experiment.id, experiment.goals);
          }
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

        // Get assignments for each experiment
        for (const experiment of this.experiments) {
          const assignment = await getOrCreateAssignment(
            experiment,
            this.userId,
            this.apiClient,
            this.context ?? undefined,
            identityMeta
          );
          this.assignments.set(experiment.id, assignment);
          this.trackingManager.registerAssignment(assignment);

          this.log(`Assigned to variant ${assignment.variantId} for experiment ${experiment.id}`);

          // Register experiment-specific goals
          if (experiment.goals && experiment.goals.length > 0) {
            this.trackingManager.registerGoals(experiment.id, experiment.goals);
          }
        }
      }

      // Register e-commerce auto-detection goals for all experiments
      // This happens after assignments are registered so global goals work
      const ecommerceGoals = getActiveEcommerceGoals();
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

      // Start auto-tracking (includes observation-based ecommerce tracking)
      this.trackingManager.startAutoTracking();

      // Observe initial pageview
      this.trackingManager.observePageview();

      this.initialized = true;
      this.log('Flame SDK initialized successfully');
    } catch (error) {
      console.error('[Flame] Failed to initialize:', error);
    }
  }

  /**
   * Apply all assigned variants to the DOM
   */
  private applyAllVariants(): void {
    for (const experiment of this.experiments) {
      const assignment = this.assignments.get(experiment.id);
      if (!assignment) continue;

      const variant = getAssignedVariant(experiment, assignment);
      if (!variant) continue;

      applyVariant(variant, this.config?.debug);
    }
  }

  /**
   * Observe an event
   *
   * @param eventType - Type of event (pageview, add_to_cart, conversion, etc.)
   * @param metadata - Optional metadata for event-specific data
   */
  observe(eventType: string, metadata?: Record<string, unknown>): void {
    if (!this.trackingManager) {
      console.warn('[Flame] SDK not initialized');
      return;
    }

    this.trackingManager.observe(eventType, metadata);
  }

  /**
   * Observe a pageview
   *
   * Call this manually for SPA navigation when the URL changes.
   * Automatically called on initial page load.
   */
  observePageview(): void {
    if (!this.trackingManager) {
      console.warn('[Flame] SDK not initialized');
      return;
    }

    this.trackingManager.observePageview();
  }

  /**
   * Observe a conversion
   *
   * Convenience method for observing conversion events.
   */
  observeConversion(metadata?: Record<string, unknown>): void {
    this.observe('conversion', metadata);
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

    // Update tracking manager with new user ID
    if (this.trackingManager && this.apiClient && this.config) {
      this.trackingManager = new TrackingManager(this.apiClient, this.userId, {
        debug: this.config.debug,
        enableBatching: this.config.enableBatching,
        batchSize: this.config.batchSize,
        flushIntervalMs: this.config.flushIntervalMs,
        dsn: this.config.dsn,
        enableOfflineStorage: this.config.enableOfflineStorage,
        maxOfflineEvents: this.config.maxOfflineEvents,
        offlineTtlMs: this.config.offlineTtlMs,
      });

      // Re-register existing assignments with new user ID
      for (const assignment of this.assignments.values()) {
        this.trackingManager.registerAssignment(assignment);
      }

      // Re-register goals
      for (const experiment of this.experiments) {
        if (experiment.goals && experiment.goals.length > 0) {
          this.trackingManager.registerGoals(experiment.id, experiment.goals);
        }
      }
    }

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
  flame.init({ dsn, debug });
}

// Run auto-init
autoInit();

// Export for manual use
export { flame, Flame };
export type {
  FlameConfig,
  PrehydratedState,
  Experiment,
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
  CreateObservationRequest,
  CreateObservationBatchRequest,
  ObservationResponse,
} from './types';
export { ObservationQueue, DEFAULT_BATCH_SIZE, DEFAULT_FLUSH_INTERVAL_MS } from './queue';
export type { ObservationQueueConfig } from './queue';
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
