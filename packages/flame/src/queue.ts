import type { CreateEventRequest } from './types';
import type { ApiClient } from './api';
import { OfflineStorage, DEFAULT_MAX_OFFLINE_EVENTS, DEFAULT_OFFLINE_TTL_MS } from './storage';

/**
 * Default batch size (number of events before auto-flush). 50
 * matches the Mixpanel / Statsig industry-typical default — large
 * enough to amortize per-request server cost ~5× over the previous
 * value of 10, small enough to fit comfortably under the ~64 KB browser
 * limit on a beacon or keepalive fetch at typical event sizes
 * (~200-700 bytes/event → 10-35 KB at batch=50).
 */
export const DEFAULT_BATCH_SIZE = 50;

/**
 * Default flush interval in milliseconds
 */
export const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * Maximum retry delay in milliseconds (30 seconds)
 */
const MAX_RETRY_DELAY_MS = 30000;

/**
 * Base retry delay in milliseconds (1 second)
 */
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Configuration for the event queue
 */
export interface EventQueueConfig {
  /** Number of events to queue before flushing (default: 50) */
  batchSize?: number;
  /** Interval in milliseconds to flush queued events (default: 5000) */
  flushIntervalMs?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** DSN for storage namespacing (required for offline storage) */
  dsn?: string;
  /** Enable offline storage (default: true) */
  enableOfflineStorage?: boolean;
  /** Maximum number of offline events (default: 100) */
  maxOfflineEvents?: number;
  /** TTL for offline events in milliseconds (default: 24 hours) */
  offlineTtlMs?: number;
}

/**
 * Event queue that batches events and flushes them periodically
 *
 * Delivery is best effort (flame#40). Events are sent:
 * - When batch size threshold is reached, or the flush interval timer
 *   fires: by keepalive fetch, which sees ember's answer
 * - When the page is unloading, or on flush(): by sendBeacon, which
 *   does not
 *
 * Offline resilience:
 * - A batch that may succeed later (network error, 5xx, 408, 429, or a
 *   beacon the browser will not queue) is persisted to localStorage and
 *   retried by fetch with exponential backoff, on coming back online, and
 *   on the next page load, until its TTL expires
 * - A batch ember refuses (any other 4xx, e.g. 402 quota_exceeded or
 *   403 origin_not_allowed) is dropped; debug mode logs why
 * - A batch the browser queued as a beacon counts as sent, whatever
 *   ember answers
 */
export class EventQueue {
  private apiClient: ApiClient;
  private queue: CreateEventRequest[] = [];
  // Told once the batch carrying their event is sent (flame#46): ember
  // accepted it, or, for a beacon, the browser queued it.
  private onSent = new Map<CreateEventRequest, () => void>();
  private batchSize: number;
  private flushIntervalMs: number;
  private debug: boolean;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unloadHandler: (() => void) | null = null;
  private offlineStorage: OfflineStorage | null = null;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private drainingOfflineStorage = false;
  // Bumped by stop(): an answer to a send from before it is ignored, so
  // consent withdrawal (flame#18) is not undone by a fetch still in flight.
  private run = 0;
  private onlineHandler: (() => void) | null = null;

  constructor(apiClient: ApiClient, config: EventQueueConfig = {}) {
    this.apiClient = apiClient;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.debug = config.debug ?? false;

    // Initialize offline storage if enabled and DSN provided
    const enableOffline = config.enableOfflineStorage ?? true;
    if (enableOffline && config.dsn) {
      this.offlineStorage = new OfflineStorage(
        config.dsn,
        config.maxOfflineEvents ?? DEFAULT_MAX_OFFLINE_EVENTS,
        config.offlineTtlMs ?? DEFAULT_OFFLINE_TTL_MS
      );
      this.log('Offline storage enabled');
    }

    this.start();
  }

  private log(...args: unknown[]) {
    if (this.debug) {
      console.log('[Flame Queue]', ...args);
    }
  }

  /**
   * Start the queue (timer and unload handler)
   */
  start(): void {
    // Start flush timer
    if (this.flushTimer === null) {
      this.flushTimer = setInterval(() => {
        this.send();
      }, this.flushIntervalMs);
      this.log('Started flush timer', { intervalMs: this.flushIntervalMs });
    }

    // Register page unload handler
    if (this.unloadHandler === null && typeof window !== 'undefined') {
      this.unloadHandler = () => {
        this.log('Page unloading, flushing queue');
        this.flush();
      };
      // Use both events for maximum browser compatibility
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.unloadHandler?.();
        }
      });
      window.addEventListener('pagehide', this.unloadHandler);
      this.log('Registered unload handlers');
    }

    // Register online handler for offline recovery
    if (this.onlineHandler === null && typeof window !== 'undefined') {
      this.onlineHandler = () => {
        this.log('Back online, flushing offline storage');
        this.flushOfflineStorage();
      };
      window.addEventListener('online', this.onlineHandler);
    }

    // Attempt to flush any previously persisted events
    this.flushOfflineStorage();
  }

  /**
   * Stop the queue (timer and unload handler)
   */
  stop(): void {
    this.run++;
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      this.log('Stopped flush timer');
    }

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    if (this.unloadHandler !== null && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.unloadHandler);
      this.unloadHandler = null;
      this.log('Removed unload handler');
    }

    if (this.onlineHandler !== null && typeof window !== 'undefined') {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
  }

  /**
   * Add an event to the queue
   *
   * If the queue reaches the batch size threshold, it will be flushed immediately.
   */
  enqueue(event: CreateEventRequest, onSent?: () => void): void {
    this.queue.push(event);
    if (onSent) this.onSent.set(event, onSent);
    this.log('Enqueued event', {
      eventType: event.event_type,
      queueSize: this.queue.length,
    });

    // Check if we should flush
    if (this.queue.length >= this.batchSize) {
      this.log('Batch size reached, sending');
      this.send();
    }
  }

  /**
   * Flush all queued events with sendBeacon, for when the page may be leaving
   *
   * A beacon outlives the page, but nothing sees ember's answer: a batch
   * the browser queues counts as sent, even if ember refuses it or fails
   * (flame#40). Only a batch the browser will not queue is kept for retry.
   * Kept events are left for {@link send} or the next page load, where a
   * failure can be seen.
   */
  flush(): void {
    if (this.queue.length === 0) {
      return;
    }

    const events = [...this.queue]; // Copy, don't clear yet

    this.log('Flushing events', { count: events.length });
    const success = this.apiClient.trackEventsBeacon(events);

    if (success) {
      this.queue = []; // Clear only on success
      this.log('Flush successful');
      for (const event of events) this.onSent.get(event)?.();
    } else {
      // Persist for retry
      this.log('Flush failed, persisting to offline storage');
      this.offlineStorage?.save(events);
      this.queue = []; // Clear in-memory queue after persisting
      this.scheduleRetry();
    }
    // A persisted event's sender is not told: it sends again next page load.
    for (const event of events) this.onSent.delete(event);
  }

  /**
   * Send all queued events while the page is open (flame#40)
   *
   * A keepalive fetch, so ember's answer is seen.
   */
  private async send(): Promise<void> {
    if (this.queue.length === 0) {
      // Kept events wait out a backoff already under way.
      if (this.retryTimer === null) {
        this.flushOfflineStorage();
      }
      return;
    }

    const events = this.queue;
    this.queue = [];
    const callbacks = events.map((event) => this.onSent.get(event));
    for (const event of events) this.onSent.delete(event);

    this.log('Sending events', { count: events.length });
    const run = this.run;
    const delivery = await this.apiClient.sendEvents(events);
    if (run !== this.run) {
      return;
    }
    if (delivery === 'sent') {
      for (const callback of callbacks) callback?.();
    } else if (delivery === 'retry') {
      // Kept for retry; its sender is not told (see flush()).
      this.offlineStorage?.save(events);
      this.scheduleRetry();
    }
  }

  /**
   * Schedule a retry with exponential backoff
   */
  private scheduleRetry(): void {
    if (this.retryTimer !== null) {
      return; // Already scheduled
    }

    // Calculate delay with exponential backoff and jitter
    const baseDelay = BASE_RETRY_DELAY_MS * Math.pow(2, this.retryAttempt);
    const jitter = Math.random() * 1000;
    const delay = Math.min(baseDelay + jitter, MAX_RETRY_DELAY_MS);

    this.retryAttempt++;
    this.log('Scheduling retry', { attempt: this.retryAttempt, delayMs: delay });

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flushOfflineStorage();
    }, delay);
  }

  /**
   * Send kept events by fetch, oldest first, one batch at a time (flame#40)
   *
   * A batch stays stored until ember answers: a page that closes mid-send
   * sends it again on the next load rather than losing it. One batch at a
   * time, because a keepalive fetch, like a beacon, is refused above
   * ~64 KB. A refused batch is removed like a sent one: it can never
   * succeed.
   */
  private async flushOfflineStorage(): Promise<void> {
    const storage = this.offlineStorage;
    if (!storage || this.drainingOfflineStorage) {
      return;
    }

    // Don't attempt if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.log('Offline, skipping offline storage flush');
      return;
    }

    const stored = storage.peek(this.batchSize);
    if (stored.length === 0) {
      this.retryAttempt = 0;
      return;
    }

    this.log('Flushing offline storage', { count: stored.length });
    this.drainingOfflineStorage = true;
    const run = this.run;
    const delivery = await this.apiClient.sendEvents(stored.map((item) => item.event));
    this.drainingOfflineStorage = false;
    if (run !== this.run) {
      return;
    }

    if (delivery === 'retry') {
      this.log('Offline storage flush failed, scheduling retry');
      this.scheduleRetry();
    } else {
      storage.remove(stored);
      this.retryAttempt = 0;
      this.log('Offline storage flushed', { delivery });
    }
  }

  /**
   * Get the current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear the queue without flushing
   */
  clear(): void {
    const count = this.queue.length;
    this.queue = [];
    this.onSent.clear();
    this.log('Cleared queue', { droppedCount: count });
  }

  /**
   * Get the offline storage instance (tests, and consent withdrawal)
   */
  getOfflineStorage(): OfflineStorage | null {
    return this.offlineStorage;
  }
}
