import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfflineStorage, DEFAULT_MAX_OFFLINE_EVENTS, DEFAULT_OFFLINE_TTL_MS } from './storage';
import type { CreateObservationRequest } from './types';

// Helper to create a test observation
const createObservation = (eventType: string): CreateObservationRequest => ({
  user_id: 'test_user',
  event_type: eventType,
});

// Mock localStorage
const createMockLocalStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get _store() {
      return store;
    },
  };
};

describe('OfflineStorage', () => {
  let mockStorage: ReturnType<typeof createMockLocalStorage>;

  beforeEach(() => {
    mockStorage = createMockLocalStorage();
    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('window', { localStorage: mockStorage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('defaults', () => {
    it('should have default max events of 100', () => {
      expect(DEFAULT_MAX_OFFLINE_EVENTS).toBe(100);
    });

    it('should have default TTL of 24 hours', () => {
      expect(DEFAULT_OFFLINE_TTL_MS).toBe(86400000);
    });
  });

  describe('isAvailable', () => {
    it('should return true when localStorage is available', () => {
      const storage = new OfflineStorage('test-dsn');
      expect(storage.isAvailable()).toBe(true);
    });

    it('should return false when localStorage throws', () => {
      mockStorage.setItem.mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });

      const storage = new OfflineStorage('test-dsn');
      expect(storage.isAvailable()).toBe(false);
    });

    it('should return false when window is undefined', () => {
      vi.stubGlobal('window', undefined);
      vi.stubGlobal('localStorage', undefined);

      const storage = new OfflineStorage('test-dsn');
      expect(storage.isAvailable()).toBe(false);
    });
  });

  describe('save and load', () => {
    it('should save and load observations', () => {
      const storage = new OfflineStorage('test-dsn');
      const observations = [createObservation('pageview'), createObservation('click')];

      storage.save(observations);
      const loaded = storage.load();

      expect(loaded).toHaveLength(2);
      expect(loaded[0].event_type).toBe('pageview');
      expect(loaded[1].event_type).toBe('click');
    });

    it('should append to existing observations', () => {
      const storage = new OfflineStorage('test-dsn');

      storage.save([createObservation('pageview')]);
      storage.save([createObservation('click')]);

      const loaded = storage.load();
      expect(loaded).toHaveLength(2);
      expect(loaded[0].event_type).toBe('pageview');
      expect(loaded[1].event_type).toBe('click');
    });

    it('should not persist when given empty array', () => {
      const storage = new OfflineStorage('test-dsn');
      storage.save([]);
      // Verify nothing was stored (isAvailable() uses a different key for testing)
      const loaded = storage.load();
      expect(loaded).toHaveLength(0);
    });

    it('should return empty array when nothing stored', () => {
      const storage = new OfflineStorage('test-dsn');
      expect(storage.load()).toEqual([]);
    });

    it('should use different storage keys for different DSNs', () => {
      const storage1 = new OfflineStorage('dsn-1');
      const storage2 = new OfflineStorage('dsn-2');

      storage1.save([createObservation('from-dsn-1')]);
      storage2.save([createObservation('from-dsn-2')]);

      expect(storage1.load()[0].event_type).toBe('from-dsn-1');
      expect(storage2.load()[0].event_type).toBe('from-dsn-2');
    });
  });

  describe('max events limit', () => {
    it('should enforce max events limit (FIFO eviction)', () => {
      const storage = new OfflineStorage('test-dsn', 3);

      storage.save([
        createObservation('event-1'),
        createObservation('event-2'),
        createObservation('event-3'),
      ]);

      // Add more observations, should evict oldest
      storage.save([createObservation('event-4'), createObservation('event-5')]);

      const loaded = storage.load();
      expect(loaded).toHaveLength(3);
      // Should keep newest 3: event-3, event-4, event-5
      expect(loaded[0].event_type).toBe('event-3');
      expect(loaded[1].event_type).toBe('event-4');
      expect(loaded[2].event_type).toBe('event-5');
    });

    it('should handle batch larger than max limit', () => {
      const storage = new OfflineStorage('test-dsn', 2);

      storage.save([
        createObservation('event-1'),
        createObservation('event-2'),
        createObservation('event-3'),
        createObservation('event-4'),
      ]);

      const loaded = storage.load();
      expect(loaded).toHaveLength(2);
      // Should keep newest 2
      expect(loaded[0].event_type).toBe('event-3');
      expect(loaded[1].event_type).toBe('event-4');
    });
  });

  describe('TTL filtering', () => {
    it('should filter expired observations on load', () => {
      const storage = new OfflineStorage('test-dsn', 100, 1000); // 1 second TTL

      // Manually insert expired data
      const now = Date.now();
      const storedData = [
        { observation: createObservation('expired'), timestamp: now - 2000 }, // 2 seconds ago
        { observation: createObservation('valid'), timestamp: now - 500 }, // 0.5 seconds ago
      ];
      mockStorage._store['flame_offline_' + hashDsnForTest('test-dsn')] =
        JSON.stringify(storedData);

      const loaded = storage.load();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].event_type).toBe('valid');
    });

    it('should filter all expired observations', () => {
      const storage = new OfflineStorage('test-dsn', 100, 1000);

      const now = Date.now();
      const storedData = [
        { observation: createObservation('expired-1'), timestamp: now - 2000 },
        { observation: createObservation('expired-2'), timestamp: now - 3000 },
      ];
      mockStorage._store['flame_offline_' + hashDsnForTest('test-dsn')] =
        JSON.stringify(storedData);

      const loaded = storage.load();
      expect(loaded).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should clear all stored observations', () => {
      const storage = new OfflineStorage('test-dsn');

      storage.save([createObservation('pageview')]);
      expect(storage.load()).toHaveLength(1);

      storage.clear();
      expect(storage.load()).toHaveLength(0);
    });
  });

  describe('count', () => {
    it('should return the number of stored observations', () => {
      const storage = new OfflineStorage('test-dsn');

      expect(storage.count()).toBe(0);

      storage.save([createObservation('pageview'), createObservation('click')]);
      expect(storage.count()).toBe(2);

      storage.save([createObservation('add_to_cart')]);
      expect(storage.count()).toBe(3);

      storage.clear();
      expect(storage.count()).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should silently fail on save when localStorage throws', () => {
      const storage = new OfflineStorage('test-dsn');

      // First make isAvailable return true, then have setItem fail
      let calls = 0;
      mockStorage.setItem.mockImplementation(() => {
        calls++;
        if (calls > 1) {
          throw new Error('QuotaExceeded');
        }
      });

      // This should not throw
      expect(() => storage.save([createObservation('pageview')])).not.toThrow();
    });

    it('should return empty array on corrupted JSON', () => {
      const storage = new OfflineStorage('test-dsn');

      mockStorage._store['flame_offline_' + hashDsnForTest('test-dsn')] = 'not valid json';

      expect(storage.load()).toEqual([]);
    });
  });
});

// Helper to hash DSN the same way the storage class does
function hashDsnForTest(dsn: string): string {
  let hash = 0;
  for (let i = 0; i < dsn.length; i++) {
    const char = dsn.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
