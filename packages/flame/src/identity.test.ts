import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getUserId,
  getDeviceId,
  getIdentity,
  identify,
  clearIdentity,
  hasPrePeriodEligibility,
} from './identity';

describe('identity', () => {
  beforeEach(() => {
    localStorage.clear();
    clearIdentity(); // Reset in-memory state
    vi.restoreAllMocks();
  });

  describe('getDeviceId', () => {
    it('should generate a new device ID when none exists', () => {
      const deviceId = getDeviceId();
      expect(deviceId).toBeDefined();
      expect(typeof deviceId).toBe('string');
      expect(deviceId.length).toBeGreaterThan(0);
    });

    it('should return the same device ID on subsequent calls', () => {
      const deviceId1 = getDeviceId();
      const deviceId2 = getDeviceId();
      expect(deviceId1).toBe(deviceId2);
    });

    it('should persist device ID in localStorage', () => {
      const deviceId = getDeviceId();
      const stored = localStorage.getItem('flame_device_id');
      expect(stored).toBe(deviceId);
    });

    it('should return existing device ID from localStorage', () => {
      const existingId = 'existing-device-id-123';
      localStorage.setItem('flame_device_id', existingId);
      const deviceId = getDeviceId();
      expect(deviceId).toBe(existingId);
    });

    it('should generate UUID-like format', () => {
      const deviceId = getDeviceId();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(deviceId).toMatch(uuidRegex);
    });
  });

  describe('getUserId', () => {
    it('should return device ID when not authenticated', () => {
      const userId = getUserId();
      const deviceId = getDeviceId();
      expect(userId).toBe(deviceId);
    });

    it('should return authenticated ID when set', () => {
      identify('auth-user-123');
      const userId = getUserId();
      expect(userId).toBe('auth-user-123');
    });
  });

  describe('getIdentity', () => {
    it('should return device identity type when not authenticated', () => {
      const identity = getIdentity();
      expect(identity.type).toBe('device');
      expect(identity.authenticatedId).toBeNull();
      expect(identity.deviceId).toBeDefined();
      expect(identity.userId).toBe(identity.deviceId);
    });

    it('should return authenticated identity type when identified', () => {
      identify('auth-user-456');
      const identity = getIdentity();
      expect(identity.type).toBe('authenticated');
      expect(identity.authenticatedId).toBe('auth-user-456');
      expect(identity.userId).toBe('auth-user-456');
      expect(identity.deviceId).toBeDefined();
      // Device ID should still be tracked separately
      expect(identity.deviceId).not.toBe('auth-user-456');
    });

    it('should track device ID creation timestamp', () => {
      const before = new Date().toISOString();
      const identity = getIdentity();
      const after = new Date().toISOString();

      expect(identity.deviceIdCreatedAt).toBeDefined();
      expect(identity.deviceIdCreatedAt! >= before).toBe(true);
      expect(identity.deviceIdCreatedAt! <= after).toBe(true);
    });

    it('should calculate device ID age', () => {
      // Set a device ID created 10 days ago
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem('flame_device_id', 'old-device-id');
      localStorage.setItem('flame_device_id_created_at', tenDaysAgo);

      const identity = getIdentity();
      expect(identity.deviceIdAgeMs).toBeDefined();
      // Should be approximately 10 days in milliseconds (with some tolerance)
      const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
      expect(identity.deviceIdAgeMs!).toBeGreaterThan(tenDaysMs - 1000);
      expect(identity.deviceIdAgeMs!).toBeLessThan(tenDaysMs + 1000);
    });

    it('should return session type when localStorage unavailable', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage not available');
      });
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      const identity = getIdentity();
      expect(identity.type).toBe('session');
      expect(identity.deviceIdCreatedAt).toBeNull();
      expect(identity.deviceIdAgeMs).toBeNull();
    });
  });

  describe('identify', () => {
    it('should set authenticated user ID', () => {
      identify('user-abc');
      expect(getUserId()).toBe('user-abc');
    });

    it('should persist authenticated ID in localStorage', () => {
      identify('user-xyz');
      const stored = localStorage.getItem('flame_authenticated_id');
      expect(stored).toBe('user-xyz');
    });

    it('should restore authenticated ID from localStorage on getIdentity', () => {
      localStorage.setItem('flame_authenticated_id', 'stored-auth-id');
      const identity = getIdentity();
      expect(identity.type).toBe('authenticated');
      expect(identity.authenticatedId).toBe('stored-auth-id');
    });

    it('should override device ID for getUserId', () => {
      const deviceId = getDeviceId();
      identify('auth-user');
      expect(getUserId()).toBe('auth-user');
      // But device ID should still be accessible
      expect(getDeviceId()).toBe(deviceId);
    });
  });

  describe('clearIdentity', () => {
    it('should clear authenticated user ID', () => {
      identify('user-to-clear');
      expect(getUserId()).toBe('user-to-clear');

      clearIdentity();
      expect(getUserId()).not.toBe('user-to-clear');
      expect(getIdentity().type).toBe('device');
    });

    it('should remove authenticated ID from localStorage', () => {
      identify('user-123');
      expect(localStorage.getItem('flame_authenticated_id')).toBe('user-123');

      clearIdentity();
      expect(localStorage.getItem('flame_authenticated_id')).toBeNull();
    });

    it('should preserve device ID after clearing', () => {
      const deviceId = getDeviceId();
      identify('auth-user');
      clearIdentity();
      expect(getDeviceId()).toBe(deviceId);
    });
  });

  describe('hasPrePeriodEligibility', () => {
    it('should return true for authenticated users', () => {
      identify('auth-user');
      expect(hasPrePeriodEligibility(7)).toBe(true);
      expect(hasPrePeriodEligibility(30)).toBe(true);
    });

    it('should return false for new device IDs', () => {
      // Fresh device ID should not be eligible
      getIdentity(); // Initialize
      expect(hasPrePeriodEligibility(7)).toBe(false);
    });

    it('should return true for old device IDs', () => {
      // Set a device ID created 14 days ago
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem('flame_device_id', 'old-device');
      localStorage.setItem('flame_device_id_created_at', fourteenDaysAgo);

      expect(hasPrePeriodEligibility(7)).toBe(true);
      expect(hasPrePeriodEligibility(14)).toBe(true);
      expect(hasPrePeriodEligibility(15)).toBe(false);
    });

    it('should return false for session-only identity', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage not available');
      });
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      expect(hasPrePeriodEligibility(0)).toBe(false);
    });

    it('should use default of 7 days when no argument provided', () => {
      // 8 days old device
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem('flame_device_id', 'week-old-device');
      localStorage.setItem('flame_device_id_created_at', eightDaysAgo);

      expect(hasPrePeriodEligibility()).toBe(true);
    });
  });
});
