/**
 * Identity management for the Flame SDK
 *
 * Supports three levels of identity:
 * 1. Authenticated user ID (best for CUPED - stable across devices)
 * 2. Device ID (good for CUPED - persisted in localStorage)
 * 3. Session ID (fallback - no CUPED benefit)
 */

const DEVICE_ID_KEY = 'flame_device_id';
const DEVICE_ID_CREATED_AT_KEY = 'flame_device_id_created_at';
const AUTHENTICATED_ID_KEY = 'flame_authenticated_id';

// Session start time (in-memory, set when SDK initializes)
let sessionStartTime: string | null = null;

/**
 * Identity type indicates how reliable the user identity is for CUPED
 */
export type IdentityType = 'authenticated' | 'device' | 'session';

/**
 * Full identity information
 */
export interface Identity {
  /** The effective user ID to use for assignments/events */
  userId: string;
  /** Type of identity (affects CUPED eligibility) */
  type: IdentityType;
  /** Device ID (always available, may differ from userId if authenticated) */
  deviceId: string;
  /** Authenticated user ID if set */
  authenticatedId: string | null;
  /** When the device ID was created (for pre-period eligibility) */
  deviceIdCreatedAt: string | null;
  /** Age of the device ID in milliseconds (null if session-only) */
  deviceIdAgeMs: number | null;
}

// In-memory fallback for session-only identity
let sessionUserId: string | null = null;
let authenticatedUserId: string | null = null;

/**
 * Initialize session start time
 *
 * Called once when the SDK initializes. This timestamp is used
 * for time-bounded identity attribution (prevents attributing
 * other users' events on shared devices).
 */
export function initSessionStart(): void {
  if (!sessionStartTime) {
    sessionStartTime = new Date().toISOString();
  }
}

/**
 * Get the session start time
 *
 * @returns ISO timestamp of when this session started, or null if not initialized
 */
export function getSessionStart(): string | null {
  return sessionStartTime;
}

/**
 * Generate a random user ID using crypto.randomUUID with fallback
 */
function generateUserId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Check if localStorage is available
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__flame_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get or create a persistent device ID
 *
 * Returns the device ID and whether it's persistent or session-only
 */
function getOrCreateDeviceId(): { id: string; createdAt: string | null; persistent: boolean } {
  if (!isLocalStorageAvailable()) {
    // Session-only fallback
    if (!sessionUserId) {
      sessionUserId = generateUserId();
    }
    return { id: sessionUserId, createdAt: null, persistent: false };
  }

  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  let createdAt = localStorage.getItem(DEVICE_ID_CREATED_AT_KEY);

  if (!deviceId) {
    deviceId = generateUserId();
    createdAt = new Date().toISOString();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    localStorage.setItem(DEVICE_ID_CREATED_AT_KEY, createdAt);
  }

  return { id: deviceId, createdAt, persistent: true };
}

/**
 * Seed the device id from an external source — used by the SSR
 * path to align the client's identity with the user_id resolved at
 * the edge.
 *
 * Only writes when no device id exists yet, so we never clobber a
 * returning visitor's existing identity. Safe to call defensively
 * during init.
 */
export function seedDeviceId(id: string, createdAt?: string): void {
  if (!isLocalStorageAvailable()) {
    if (!sessionUserId) sessionUserId = id;
    return;
  }
  if (!localStorage.getItem(DEVICE_ID_KEY)) {
    localStorage.setItem(DEVICE_ID_KEY, id);
    localStorage.setItem(DEVICE_ID_CREATED_AT_KEY, createdAt ?? new Date().toISOString());
  }
}

/**
 * Set the authenticated user ID
 *
 * Call this when a user logs in to enable cross-device identity
 * and more reliable CUPED analysis.
 *
 * @param userId - The authenticated user ID from your system
 */
export function identify(userId: string): void {
  authenticatedUserId = userId;

  if (isLocalStorageAvailable()) {
    localStorage.setItem(AUTHENTICATED_ID_KEY, userId);
  }
}

/**
 * Clear the authenticated user ID
 *
 * Call this when a user logs out.
 */
export function clearIdentity(): void {
  authenticatedUserId = null;

  if (isLocalStorageAvailable()) {
    localStorage.removeItem(AUTHENTICATED_ID_KEY);
  }
}

/**
 * Get the full identity information
 *
 * Returns the effective user ID along with metadata about
 * identity stability (useful for CUPED eligibility).
 */
export function getIdentity(): Identity {
  const device = getOrCreateDeviceId();

  // Check for authenticated ID (in-memory first, then localStorage)
  let authId = authenticatedUserId;
  if (!authId && isLocalStorageAvailable()) {
    authId = localStorage.getItem(AUTHENTICATED_ID_KEY);
    if (authId) {
      authenticatedUserId = authId; // Cache in memory
    }
  }

  // Calculate device ID age
  let deviceIdAgeMs: number | null = null;
  if (device.createdAt) {
    deviceIdAgeMs = Date.now() - new Date(device.createdAt).getTime();
  }

  // Determine identity type and effective user ID
  let type: IdentityType;
  let userId: string;

  if (authId) {
    type = 'authenticated';
    userId = authId;
  } else if (device.persistent) {
    type = 'device';
    userId = device.id;
  } else {
    type = 'session';
    userId = device.id;
  }

  return {
    userId,
    type,
    deviceId: device.id,
    authenticatedId: authId,
    deviceIdCreatedAt: device.createdAt,
    deviceIdAgeMs,
  };
}

/**
 * Get the effective user ID for API calls
 *
 * Convenience method that returns just the user ID.
 * Use getIdentity() if you need metadata.
 */
export function getUserId(): string {
  return getIdentity().userId;
}

/**
 * Get the device ID (regardless of authentication status)
 *
 * Useful for linking device behavior to authenticated users.
 */
export function getDeviceId(): string {
  return getOrCreateDeviceId().id;
}

/**
 * Check if the identity has been stable long enough for CUPED
 *
 * @param minAgeDays - Minimum age in days (default: 7)
 * @returns true if identity is old enough for pre-period data
 */
export function hasPrePeriodEligibility(minAgeDays = 7): boolean {
  const identity = getIdentity();

  // Authenticated users are always eligible (server has their history)
  if (identity.type === 'authenticated') {
    return true;
  }

  // Session-only users are never eligible
  if (identity.type === 'session') {
    return false;
  }

  // Check device ID age
  if (identity.deviceIdAgeMs === null) {
    return false;
  }

  const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
  return identity.deviceIdAgeMs >= minAgeMs;
}
