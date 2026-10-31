import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUserId } from './assignment';

describe('assignment', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('getUserId', () => {
    it('should generate a new user ID when none exists', () => {
      const userId = getUserId();
      expect(userId).toBeDefined();
      expect(typeof userId).toBe('string');
      expect(userId.length).toBeGreaterThan(0);
    });

    it('should return the same user ID on subsequent calls', () => {
      const userId1 = getUserId();
      const userId2 = getUserId();
      expect(userId1).toBe(userId2);
    });

    it('should persist user ID in localStorage', () => {
      const userId = getUserId();
      const stored = localStorage.getItem('flame_device_id');
      expect(stored).toBe(userId);
    });

    it('should return existing user ID from localStorage', () => {
      const existingId = 'existing-user-id-123';
      localStorage.setItem('flame_device_id', existingId);
      const userId = getUserId();
      expect(userId).toBe(existingId);
    });

    it('should generate UUID-like format', () => {
      const userId = getUserId();
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(userId).toMatch(uuidRegex);
    });

    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw errors (simulating private browsing)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage not available');
      });
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      // Should still return a valid user ID (session-only)
      const userId = getUserId();
      expect(userId).toBeDefined();
      expect(typeof userId).toBe('string');
    });
  });
});
