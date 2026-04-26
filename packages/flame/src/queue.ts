import type { CreateObservationRequest } from './types';
import type { ApiClient } from './api';
import { OfflineStorage, DEFAULT_MAX_OFFLINE_EVENTS, DEFAULT_OFFLINE_TTL_MS } from './storage';

/**
 * Default batch size (number of observations before auto-flush). 50
 * matches the Mixpanel / Statsig industry-typical default — large
 * enough to amortize per-request server cost ~5× over the previous
 * value of 10, small enough to fit comfortably under sendBeacon's
 * ~64 KB browser limit at typical observation sizes
 * (~200-700 bytes/obs → 10-35 KB at batch=50).
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
 * Configuration for the observation queue
 */
export interface ObservationQueueConfig {
  /** Number of observations to queue before flushing (default: 50) */
  batchSize?: number;
  /** Interval in milliseconds to flush queued observations (default: 5000) */
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
 * Observation queue that batches observations and flushes them periodically
 *
 * Observations are queued and flushed:
 * - When batch size threshold is reached
 * - When flush interval timer fires
 * - When page is unloading (guaranteed delivery via sendBeacon)
 *
 * Offline resilience:
 * - Failed observations are persisted to localStorage
 * - Automatic retry with exponential backoff
 * - Flushes persisted observations when coming back online
 */
export class ObservationQueue {
  private apiClient: ApiClient;
  private queue: CreateObservationRequest[] = [];
  private batchSize: number;
  private flushIntervalMs: number;
  private debug: boolean;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unloadHandler: (() => void) | null = null;
  private offlineStorage: OfflineStorage | null = null;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineHandler: (() => void) | null = null;

  constructor(apiClient: ApiClient, config: ObservationQueueConfig = {}) {
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
        this.flush();
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

    // Attempt to flush any previously persisted observations
    this.flushOfflineStorage();
  }

  /**
   * Stop the queue (timer and unload handler)
   */
  stop(): void {
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
   * Add an observation to the queue
   *
   * If the queue reaches the batch size threshold, it will be flushed immediately.
   */
  enqueue(observation: CreateObservationRequest): void {
    this.queue.push(observation);
    this.log('Enqueued observation', {
      eventType: observation.event_type,
      queueSize: this.queue.length,
    });

    // Check if we should flush
    if (this.queue.length >= this.batchSize) {
      this.log('Batch size reached, flushing');
      this.flush();
    }
  }

  /**
   * Flush all queued observations
   *
   * Uses sendBeacon for reliable delivery, especially during page unload.
   * If sendBeacon fails, observations are persisted to offline storage.
   */
  flush(): void {
    if (this.queue.length === 0) {
      // Also try to flush any persisted observations
      this.flushOfflineStorage();
      return;
    }

    const observations = [...this.queue]; // Copy, don't clear yet

    this.log('Flushing observations', { count: observations.length });
    const success = this.apiClient.trackObservationsBatchBeacon(observations);

    if (success) {
      this.queue = []; // Clear only on success
      this.log('Flush successful');
    } else {
      // Persist for retry
      this.log('Flush failed, persisting to offline storage');
      this.offlineStorage?.save(observations);
      this.queue = []; // Clear in-memory queue after persisting
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
   * Flush observations from offline storage
   */
  private flushOfflineStorage(): void {
    if (!this.offlineStorage) {
      return;
    }

    // Don't attempt if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.log('Offline, skipping offline storage flush');
      return;
    }

    const stored = this.offlineStorage.load();
    if (stored.length === 0) {
      this.retryAttempt = 0;
      return;
    }

    this.log('Flushing offline storage', { count: stored.length });
    const success = this.apiClient.trackObservationsBatchBeacon(stored);

    if (success) {
      this.offlineStorage.clear();
      this.retryAttempt = 0;
      this.log('Offline storage flushed successfully');
    } else {
      this.log('Offline storage flush failed, scheduling retry');
      this.scheduleRetry();
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
    this.log('Cleared queue', { droppedCount: count });
  }

  /**
   * Get the offline storage instance (for testing)
   */
  getOfflineStorage(): OfflineStorage | null {
    return this.offlineStorage;
  }
}
