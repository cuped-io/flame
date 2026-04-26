import type { CreateObservationRequest } from './types';

/**
 * Default maximum number of events to store offline
 */
export const DEFAULT_MAX_OFFLINE_EVENTS = 100;

/**
 * Default TTL for offline events in milliseconds (24 hours)
 */
export const DEFAULT_OFFLINE_TTL_MS = 86400000;

/**
 * Storage key prefix for offline observations
 */
const STORAGE_KEY_PREFIX = 'flame_offline_';

/**
 * Stored observation with timestamp for TTL filtering
 */
export interface StoredObservation {
  observation: CreateObservationRequest;
  timestamp: number;
}

/**
 * Simple hash function to create a short key from DSN
 */
function hashDsn(dsn: string): string {
  let hash = 0;
  for (let i = 0; i < dsn.length; i++) {
    const char = dsn.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Offline storage for observations when network requests fail
 *
 * Features:
 * - Storage key namespaced by DSN hash to avoid collisions
 * - Silently fails if localStorage unavailable (SSR, private browsing)
 * - Discards oldest events when over limit (FIFO)
 * - Filters expired events on load
 */
export class OfflineStorage {
  private storageKey: string;
  private maxEvents: number;
  private ttlMs: number;

  constructor(dsn: string, maxEvents = DEFAULT_MAX_OFFLINE_EVENTS, ttlMs = DEFAULT_OFFLINE_TTL_MS) {
    this.storageKey = STORAGE_KEY_PREFIX + hashDsn(dsn);
    this.maxEvents = maxEvents;
    this.ttlMs = ttlMs;
  }

  /**
   * Check if localStorage is available
   */
  isAvailable(): boolean {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return false;
    }

    try {
      const testKey = '__flame_storage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save observations to localStorage
   *
   * New observations are appended to existing ones.
   * If the total exceeds maxEvents, oldest events are discarded (FIFO).
   */
  save(observations: CreateObservationRequest[]): void {
    if (!this.isAvailable() || observations.length === 0) {
      return;
    }

    try {
      const now = Date.now();
      const newStored: StoredObservation[] = observations.map((observation) => ({
        observation,
        timestamp: now,
      }));

      // Load existing observations (already filters expired)
      const existingStored = this.loadStored();

      // Combine existing and new
      const combined = [...existingStored, ...newStored];

      // Enforce max limit - keep newest events (FIFO eviction of oldest)
      const toKeep = combined.slice(-this.maxEvents);

      localStorage.setItem(this.storageKey, JSON.stringify(toKeep));
    } catch {
      // Silently fail - localStorage might be full or unavailable
    }
  }

  /**
   * Load observations from localStorage
   *
   * Filters out expired observations based on TTL.
   */
  load(): CreateObservationRequest[] {
    return this.loadStored().map((stored) => stored.observation);
  }

  /**
   * Load stored observations with timestamps (for internal use)
   */
  private loadStored(): StoredObservation[] {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) {
        return [];
      }

      const stored: StoredObservation[] = JSON.parse(raw);
      const now = Date.now();

      // Filter expired observations
      return stored.filter((item) => now - item.timestamp < this.ttlMs);
    } catch {
      return [];
    }
  }

  /**
   * Clear all stored observations
   */
  clear(): void {
    if (!this.isAvailable()) {
      return;
    }

    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // Silently fail
    }
  }

  /**
   * Get the number of stored observations
   */
  count(): number {
    return this.loadStored().length;
  }
}
