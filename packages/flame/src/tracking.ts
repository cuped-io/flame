import type {
  StoredAssignment,
  Goal,
  ExperimentAssignment,
  CreateEventRequest,
  IdentityMetadata,
} from './types';
import type { ApiClient } from './api';
import { EventQueue, type EventQueueConfig } from './queue';

/**
 * Registered goal for auto-detection
 */
interface RegisteredGoal {
  goal: Goal;
}

/**
 * Configuration for the tracking manager
 */
export interface TrackingManagerConfig {
  /** Enable debug logging */
  debug?: boolean;
  /** Enable event batching (default: true) */
  enableBatching?: boolean;
  /** Number of events to queue before flushing (default: 10) */
  batchSize?: number;
  /** Interval in milliseconds to flush queued events (default: 5000) */
  flushIntervalMs?: number;
  /** DSN for storage namespacing (required for offline storage) */
  dsn?: string;
  /** Enable offline storage (default: true when batching enabled) */
  enableOfflineStorage?: boolean;
  /** Maximum number of offline events (default: 100) */
  maxOfflineEvents?: number;
  /** TTL for offline events in milliseconds (default: 24 hours) */
  offlineTtlMs?: number;
}

/**
 * Tracking manager for event tracking
 *
 * Uses sendBeacon for reliable event delivery, ensuring events are sent
 * even when the page is navigating away (e.g., checkout clicks that redirect
 * to external checkout pages).
 *
 * All tracking uses the single-event model:
 * - Single event per user action (not per experiment)
 * - Experiment assignments included for server-side goal matching
 * - Goals matched server-side during ingestion
 *
 * When batching is enabled (default), events are queued and sent in batches
 * for improved efficiency.
 */
export class TrackingManager {
  private apiClient: ApiClient;
  private assignments: Map<string, StoredAssignment>;
  private userId: string;
  private debug: boolean;
  private clickHandler: ((event: MouseEvent) => void) | null = null;
  private submitHandler: ((event: SubmitEvent) => void) | null = null;
  private registeredGoals: RegisteredGoal[] = [];
  private queue: EventQueue | null = null;
  private enableBatching: boolean;

  constructor(apiClient: ApiClient, userId: string, config: TrackingManagerConfig = {}) {
    this.apiClient = apiClient;
    this.userId = userId;
    this.assignments = new Map();
    this.debug = config.debug ?? false;
    this.enableBatching = config.enableBatching ?? true;

    // Initialize event queue if batching is enabled
    if (this.enableBatching) {
      const queueConfig: EventQueueConfig = {
        batchSize: config.batchSize,
        flushIntervalMs: config.flushIntervalMs,
        debug: this.debug,
        dsn: config.dsn,
        enableOfflineStorage: config.enableOfflineStorage,
        maxOfflineEvents: config.maxOfflineEvents,
        offlineTtlMs: config.offlineTtlMs,
      };
      this.queue = new EventQueue(apiClient, queueConfig);
    }
  }

  /**
   * Switch the user every later event is stamped with (identify, logout).
   * Events already created keep the ID they were created under, since
   * `track` stamps `user_id` at creation. One manager across identity
   * changes, so listeners, goals and the queue are never duplicated or
   * dropped (flame#36).
   */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * Register an assignment for tracking
   */
  registerAssignment(assignment: StoredAssignment): void {
    this.assignments.set(assignment.experimentId, assignment);
  }

  /**
   * Register goals for DOM auto-tracking. Only `click` and `submit`
   * goals get registered here — they need DOM listeners on
   * `goal.selector` so the SDK can fire `goal.name` when the user
   * clicks/submits a matching element.
   *
   * `pageview` and `custom` goals are intentionally skipped:
   * - `pageview` is fired by `trackPageview()` (called from `init`
   *   and on SPA navigation).
   * - `custom` is fired manually by the developer via
   *   `flame.track(goal.name)` / `useTrack()` — there's no DOM
   *   event to listen to.
   */
  registerGoals(_experimentId: string, goals: Goal[]): void {
    for (const goal of goals) {
      if (goal.type === 'click' || goal.type === 'submit') {
        this.registeredGoals.push({ goal });
      }
    }
    if (this.debug && goals.length > 0) {
      console.log(`[Flame] Registered ${goals.length} goals for auto-detection`);
    }
  }

  /**
   * Register global goals (e.g., e-commerce auto-detection)
   */
  registerGlobalGoals(goals: Goal[]): void {
    if (this.debug) {
      console.log(`[Flame] Registering ${goals.length} global goals`);
      for (const goal of goals) {
        const selectorPreview = goal.selector ? goal.selector.substring(0, 100) : 'N/A';
        console.log(`[Flame] Global goal: ${goal.name} (${goal.type}) - ${selectorPreview}...`);
      }
    }
    for (const goal of goals) {
      if (goal.type === 'click' || goal.type === 'submit') {
        this.registeredGoals.push({ goal });
      }
    }
  }

  /**
   * Start auto-tracking clicks and form submissions
   */
  startAutoTracking(): void {
    if (this.clickHandler) {
      return;
    }

    this.clickHandler = (event: MouseEvent) => {
      this.handleClick(event);
    };

    this.submitHandler = (event: SubmitEvent) => {
      this.handleSubmit(event);
    };

    document.addEventListener('click', this.clickHandler, true);
    document.addEventListener('submit', this.submitHandler, true);

    if (this.debug) {
      console.log('[Flame] Started auto-tracking clicks and form submissions');
    }
  }

  /**
   * Shut down for consent withdrawal (flame#18) and send nothing more.
   * Unlike stopAutoTracking, which flushes first, this DROPS what is queued.
   * Synchronous, so no unload or tab-hide flush can interleave; the order
   * (disarm the flush triggers, drop the queue, delete the retry store) is
   * insurance should an await ever be added.
   */
  discard(): void {
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }
    if (this.submitHandler) {
      document.removeEventListener('submit', this.submitHandler, true);
      this.submitHandler = null;
    }
    if (this.queue) {
      this.queue.stop();
      this.queue.clear();
      this.queue.getOfflineStorage()?.clear();
    }
  }

  /**
   * Stop auto-tracking
   */
  stopAutoTracking(): void {
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }

    if (this.submitHandler) {
      document.removeEventListener('submit', this.submitHandler, true);
      this.submitHandler = null;
    }

    // Stop the queue (flushes remaining events)
    if (this.queue) {
      this.queue.flush();
      this.queue.stop();
    }

    if (this.debug) {
      console.log('[Flame] Stopped auto-tracking');
    }
  }

  /**
   * Handle a click event
   */
  private handleClick(event: MouseEvent): void {
    const target = event.target as Element;
    if (!target) {
      return;
    }

    if (this.debug) {
      console.log('[Flame] Click detected on:', target.tagName, target.className);
    }

    // Check if the clicked element was modified by Flame (variant applied)
    const modifiedElement = this.findModifiedElement(target);
    if (modifiedElement) {
      const selector = modifiedElement.getAttribute('data-flame-selector');
      if (selector) {
        this.track('click', { selector, variant_click: true });
      }
    }

    // Check for goal matches
    this.checkGoalMatch(target, 'click');
  }

  /**
   * Handle a form submit event
   */
  private handleSubmit(event: SubmitEvent): void {
    const target = event.target as Element;
    if (!target) return;

    this.checkGoalMatch(target, 'submit');
  }

  /**
   * Check if an element matches any registered goals and fire events
   */
  private checkGoalMatch(element: Element, eventType: 'click' | 'submit'): void {
    if (this.debug) {
      console.log(`[Flame] Checking ${this.registeredGoals.length} goals for ${eventType} event`);
    }

    // Track which goal names we've already fired (dedup)
    const fired = new Set<string>();

    for (const { goal } of this.registeredGoals) {
      if (goal.type !== eventType) {
        continue;
      }

      // A submit goal with no selector matches any form submit — the
      // no-code "track any form on the page" case. A click goal with no
      // selector has no target to bind to (every click would fire it),
      // so it's only trackable manually via flame.track(); skip it.
      let matches: boolean;
      if (goal.selector) {
        matches = this.elementMatchesGoal(element, goal.selector);
      } else {
        matches = eventType === 'submit';
      }

      if (this.debug) {
        console.log(`[Flame] Goal ${goal.name} match:`, matches);
      }

      if (matches && !fired.has(goal.name)) {
        this.track(goal.name, {
          selector: goal.selector,
          event_type: goal.type,
        });
        fired.add(goal.name);
      }
    }
  }

  /**
   * Check if an element or any of its parents match a selector
   */
  private elementMatchesGoal(element: Element, selector: string): boolean {
    try {
      if (element.matches(selector)) {
        return true;
      }
      return element.closest(selector) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Find the closest element modified by Flame
   */
  private findModifiedElement(element: Element): Element | null {
    let current: Element | null = element;

    while (current) {
      if (current.getAttribute('data-flame-modified') === 'true') {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  // ============================================================================
  // Event API
  // ============================================================================

  /**
   * Get current experiment assignments for inclusion in events
   */
  getExperimentAssignments(): ExperimentAssignment[] {
    const assignments: ExperimentAssignment[] = [];
    for (const [experimentId, assignment] of this.assignments) {
      assignments.push({
        experiment_id: experimentId,
        variant_id: assignment.variantId,
      });
    }
    return assignments;
  }

  /**
   * Track an event
   *
   * Events are project-scoped and:
   * - Fire ONCE per user action, regardless of experiment count
   * - Include experiment assignments for server-side goal derivation
   * - Goals are matched server-side during ingestion
   * - Automatically enriched with page context (url, path, title, referrer)
   *
   * When batching is enabled, events are queued and sent in batches.
   * When batching is disabled, the event is sent immediately via
   * sendBeacon as a one-element `{ events: [...] }` array.
   */
  track(eventType: string, metadata?: Record<string, unknown>): void {
    const experimentAssignments = this.getExperimentAssignments();

    // Auto-enrich with page context (user metadata takes precedence)
    const enrichedMetadata: Record<string, unknown> = {
      url: window.location.href,
      path: window.location.pathname,
      title: document.title,
      referrer: document.referrer || undefined,
      ...metadata,
    };

    if (this.debug) {
      console.log('[Flame] Tracking:', {
        eventType,
        metadata: enrichedMetadata,
        experimentAssignments: experimentAssignments.length,
        batching: this.enableBatching,
      });
    }

    const event: CreateEventRequest = {
      user_id: this.userId,
      event_type: eventType,
      metadata: enrichedMetadata,
      experiment_assignments: experimentAssignments.length > 0 ? experimentAssignments : undefined,
    };

    if (this.queue) {
      // Batching enabled: enqueue the event
      this.queue.enqueue(event);
    } else {
      // Batching disabled: send immediately as an array of one
      this.apiClient.trackEventsBeacon([event]);
    }
  }

  /**
   * Flush any queued events immediately
   *
   * Call this when you need to ensure events are sent right away,
   * e.g., before a critical navigation.
   */
  flush(): void {
    if (this.queue) {
      this.queue.flush();
    }
  }

  /**
   * Track a pageview
   */
  trackPageview(): void {
    this.track('pageview');
  }

  /**
   * The record step (flame#46, ember ADR 0041): the arm flame just delivered,
   * as a reserved `$assignment` event. ember writes the visitor's assignment
   * from it; until then they are not counted. Its `path` is the page it was
   * delivered on, which ember checks against the experiment's `url_pattern`
   * (flame#50). It carries no other page context and no
   * `experiment_assignments`: it is not an event to attribute.
   * `occurred_at` is now, which ember uses as `assigned_at`.
   *
   * Returns false when it drops a record ember would refuse. `onSent` runs
   * once the browser accepts the batch carrying the record; a batch kept for
   * retry does not count, so the arm is recorded again on the next page load.
   */
  recordAssignment(
    experimentId: string,
    variantId: string,
    extras: { context?: Record<string, unknown>; identity?: IdentityMetadata; path?: string } = {},
    onSent?: () => void
  ): boolean {
    const event: CreateEventRequest = {
      user_id: this.userId,
      event_type: ASSIGNMENT_EVENT_TYPE,
      metadata: { experiment_id: experimentId, variant_id: variantId, ...extras },
      occurred_at: new Date().toISOString(),
    };
    // ember refuses the whole envelope over one malformed record, taking the
    // pageview with it, so a record it would refuse is dropped here instead.
    const refusal = !experimentId
      ? 'no experiment id'
      : !variantId
        ? 'no variant id'
        : new TextEncoder().encode(JSON.stringify(event.metadata)).length > MAX_METADATA_BYTES
          ? `metadata over ${MAX_METADATA_BYTES} bytes`
          : null;
    if (refusal) {
      console.warn(`[Flame] Not recording an assignment ember would refuse (${refusal}).`);
      return false;
    }
    if (this.debug) {
      console.log('[Flame] Recording assignment:', event.metadata);
    }
    if (this.queue) {
      this.queue.enqueue(event, onSent);
    } else if (this.apiClient.trackEventsBeacon([event])) {
      onSent?.();
    }
    return true;
  }
}

/** ember's reserved event type for the record step (ADR 0041). */
export const ASSIGNMENT_EVENT_TYPE = '$assignment';

/** ember's cap on an event's serialized metadata (MAX_METADATA_BYTES). */
const MAX_METADATA_BYTES = 4 * 1024;
