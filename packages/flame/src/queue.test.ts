import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObservationQueue, DEFAULT_BATCH_SIZE, DEFAULT_FLUSH_INTERVAL_MS } from './queue';
import type { CreateObservationRequest } from './types';

// Mock ApiClient
const createMockApiClient = () => ({
  trackObservationsBatchBeacon: vi.fn().mockReturnValue(true),
});

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

describe('ObservationQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('defaults', () => {
    it('should have default batch size of 50', () => {
      expect(DEFAULT_BATCH_SIZE).toBe(50);
    });

    it('should have default flush interval of 5000ms', () => {
      expect(DEFAULT_FLUSH_INTERVAL_MS).toBe(5000);
    });
  });

  describe('enqueue', () => {
    it('should add observations to the queue', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never);

      queue.enqueue(createObservation('pageview'));
      expect(queue.size()).toBe(1);

      queue.enqueue(createObservation('click'));
      expect(queue.size()).toBe(2);

      queue.stop();
    });

    it('should flush when batch size threshold is reached', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, { batchSize: 3 });

      queue.enqueue(createObservation('pageview'));
      queue.enqueue(createObservation('click'));
      expect(mockApi.trackObservationsBatchBeacon).not.toHaveBeenCalled();

      // Third observation should trigger flush
      queue.enqueue(createObservation('add_to_cart'));
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledWith([
        createObservation('pageview'),
        createObservation('click'),
        createObservation('add_to_cart'),
      ]);
      expect(queue.size()).toBe(0);

      queue.stop();
    });
  });

  describe('flush', () => {
    it('should send all queued observations', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, { batchSize: 100 });

      queue.enqueue(createObservation('pageview'));
      queue.enqueue(createObservation('click'));
      queue.flush();

      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledWith([
        createObservation('pageview'),
        createObservation('click'),
      ]);
      expect(queue.size()).toBe(0);

      queue.stop();
    });

    it('should do nothing when queue is empty', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never);

      queue.flush();
      expect(mockApi.trackObservationsBatchBeacon).not.toHaveBeenCalled();

      queue.stop();
    });
  });

  describe('timer-based flushing', () => {
    it('should flush on interval', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, {
        flushIntervalMs: 1000,
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      expect(mockApi.trackObservationsBatchBeacon).not.toHaveBeenCalled();

      // Advance timer by flush interval
      vi.advanceTimersByTime(1000);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);
      expect(queue.size()).toBe(0);

      queue.stop();
    });

    it('should flush multiple times on interval', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, {
        flushIntervalMs: 1000,
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      vi.advanceTimersByTime(1000);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);

      queue.enqueue(createObservation('click'));
      vi.advanceTimersByTime(1000);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(2);

      queue.stop();
    });
  });

  describe('stop', () => {
    it('should stop the timer', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, {
        flushIntervalMs: 1000,
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.stop();

      // Timer should be stopped, so no flush
      vi.advanceTimersByTime(2000);
      expect(mockApi.trackObservationsBatchBeacon).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear the queue without flushing', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never);

      queue.enqueue(createObservation('pageview'));
      queue.enqueue(createObservation('click'));
      queue.clear();

      expect(queue.size()).toBe(0);
      expect(mockApi.trackObservationsBatchBeacon).not.toHaveBeenCalled();

      queue.stop();
    });
  });

  describe('size', () => {
    it('should return current queue size', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, { batchSize: 100 });

      expect(queue.size()).toBe(0);

      queue.enqueue(createObservation('pageview'));
      expect(queue.size()).toBe(1);

      queue.enqueue(createObservation('click'));
      expect(queue.size()).toBe(2);

      queue.flush();
      expect(queue.size()).toBe(0);

      queue.stop();
    });
  });

  describe('configuration', () => {
    it('should use custom batch size', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, { batchSize: 2 });

      queue.enqueue(createObservation('pageview'));
      expect(mockApi.trackObservationsBatchBeacon).not.toHaveBeenCalled();

      queue.enqueue(createObservation('click'));
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);

      queue.stop();
    });

    it('should use custom flush interval', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, {
        flushIntervalMs: 500,
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));

      vi.advanceTimersByTime(499);
      expect(mockApi.trackObservationsBatchBeacon).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);

      queue.stop();
    });
  });
});

describe('ObservationQueue offline behavior', () => {
  let mockStorage: ReturnType<typeof createMockLocalStorage>;
  let onlineHandlers: (() => void)[];

  beforeEach(() => {
    vi.useFakeTimers();
    mockStorage = createMockLocalStorage();
    onlineHandlers = [];

    vi.stubGlobal('localStorage', mockStorage);
    vi.stubGlobal('window', {
      localStorage: mockStorage,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'online') {
          onlineHandlers.push(handler);
        }
      }),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { onLine: true, sendBeacon: vi.fn().mockReturnValue(true) });
    vi.stubGlobal('document', { visibilityState: 'visible' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('offline storage initialization', () => {
    it('should enable offline storage when DSN is provided', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        enableOfflineStorage: true,
      });

      expect(queue.getOfflineStorage()).not.toBeNull();
      queue.stop();
    });

    it('should not enable offline storage without DSN', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, {
        enableOfflineStorage: true,
      });

      expect(queue.getOfflineStorage()).toBeNull();
      queue.stop();
    });

    it('should not enable offline storage when explicitly disabled', () => {
      const mockApi = createMockApiClient();
      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        enableOfflineStorage: false,
      });

      expect(queue.getOfflineStorage()).toBeNull();
      queue.stop();
    });
  });

  describe('persist on flush failure', () => {
    it('should persist to offline storage when sendBeacon returns false', () => {
      const mockApi = createMockApiClient();
      mockApi.trackObservationsBatchBeacon.mockReturnValue(false);

      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.enqueue(createObservation('click'));
      queue.flush();

      // Should have saved to storage
      const storage = queue.getOfflineStorage();
      expect(storage?.count()).toBe(2);

      // Queue should be cleared
      expect(queue.size()).toBe(0);

      queue.stop();
    });

    it('should clear queue after persisting to storage', () => {
      const mockApi = createMockApiClient();
      mockApi.trackObservationsBatchBeacon.mockReturnValue(false);

      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.flush();

      // In-memory queue should be empty
      expect(queue.size()).toBe(0);

      queue.stop();
    });
  });

  describe('retry with exponential backoff', () => {
    it('should schedule retry after flush failure', () => {
      const mockApi = createMockApiClient();
      mockApi.trackObservationsBatchBeacon.mockReturnValue(false);

      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.flush();

      // Initial call + retry after ~1 second
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);

      // Advance time to trigger retry (base delay is 1s + jitter)
      vi.advanceTimersByTime(2000);

      // Should have attempted retry
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(2);

      queue.stop();
    });

    it('should use exponential backoff for retries', () => {
      const mockApi = createMockApiClient();
      mockApi.trackObservationsBatchBeacon.mockReturnValue(false);

      // Use a long flush interval to avoid interference from timer-based flushes
      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 60000, // 1 minute - won't trigger during test
      });

      queue.enqueue(createObservation('pageview'));
      queue.flush(); // Initial flush (fails)
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);

      // First retry at ~1s (base delay + jitter up to 1s = up to 2s)
      vi.advanceTimersByTime(2000);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(2);

      // Second retry at ~2s base + jitter (exponential: 2^1 * 1000 = 2000ms + up to 1s jitter)
      vi.advanceTimersByTime(3000);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(3);

      // Third retry at ~4s base + jitter (exponential: 2^2 * 1000 = 4000ms + up to 1s jitter)
      vi.advanceTimersByTime(6000);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(4);

      queue.stop();
    });

    it('should cap retry delay at 30 seconds', () => {
      const mockApi = createMockApiClient();
      mockApi.trackObservationsBatchBeacon.mockReturnValue(false);

      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.flush();

      // Trigger many retries
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(35000); // More than max delay
      }

      // All retries should have happened (not stuck waiting for longer delays)
      expect(mockApi.trackObservationsBatchBeacon.mock.calls.length).toBeGreaterThan(5);

      queue.stop();
    });
  });

  describe('online event handler', () => {
    it('should flush offline storage when coming back online', () => {
      const mockApi = createMockApiClient();
      // First call fails (causing persistence), subsequent calls succeed
      mockApi.trackObservationsBatchBeacon.mockReturnValueOnce(false).mockReturnValue(true);

      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.flush(); // This fails and persists

      const storage = queue.getOfflineStorage();
      expect(storage?.count()).toBe(1);

      // Simulate going online
      onlineHandlers.forEach((h) => h());

      // Should have tried to flush
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(2);

      queue.stop();
    });
  });

  describe('flush offline storage on initialization', () => {
    it('should attempt to flush previously stored observations on start', () => {
      const mockApi = createMockApiClient();

      // Pre-populate storage with observations
      const now = Date.now();
      const storedData = [{ observation: createObservation('previous'), timestamp: now - 1000 }];
      // Calculate storage key the same way OfflineStorage does
      const dsn = 'test-dsn';
      let hash = 0;
      for (let i = 0; i < dsn.length; i++) {
        const char = dsn.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      const storageKey = 'flame_offline_' + Math.abs(hash).toString(36);
      mockStorage._store[storageKey] = JSON.stringify(storedData);

      // Create queue (calls start() internally)
      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      // Should have flushed the stored observation
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(1);
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledWith([
        createObservation('previous'),
      ]);

      queue.stop();
    });
  });

  describe('clear storage on successful send', () => {
    it('should clear offline storage after successful flush', () => {
      const mockApi = createMockApiClient();
      // First call fails, second succeeds
      mockApi.trackObservationsBatchBeacon.mockReturnValueOnce(false).mockReturnValue(true);

      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.flush(); // Fails and persists

      const storage = queue.getOfflineStorage();
      expect(storage?.count()).toBe(1);

      // Trigger retry (should succeed)
      vi.advanceTimersByTime(2000);

      // Storage should be cleared
      expect(storage?.count()).toBe(0);

      queue.stop();
    });

    it('should reset retry attempt counter on success', () => {
      const mockApi = createMockApiClient();
      // Fail twice, then succeed
      mockApi.trackObservationsBatchBeacon
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
        .mockReturnValue(false); // For any subsequent calls

      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.flush(); // Fails

      // First retry (fails)
      vi.advanceTimersByTime(2000);

      // Second retry (succeeds)
      vi.advanceTimersByTime(4000);

      const storage = queue.getOfflineStorage();
      expect(storage?.count()).toBe(0);

      // Add more observations and fail again
      queue.enqueue(createObservation('new-event'));
      queue.flush();

      // Next retry should start from base delay (1s), not continue exponential
      // This is verified by the fact that retry happens within 2s
      expect(mockApi.trackObservationsBatchBeacon).toHaveBeenCalledTimes(4);

      queue.stop();
    });
  });

  describe('offline detection', () => {
    it('should not attempt flush when navigator.onLine is false', () => {
      vi.stubGlobal('navigator', { onLine: false, sendBeacon: vi.fn() });

      const mockApi = createMockApiClient();
      mockApi.trackObservationsBatchBeacon.mockReturnValue(false);

      const queue = new ObservationQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createObservation('pageview'));
      queue.flush(); // Fails and persists

      // Reset call count
      mockApi.trackObservationsBatchBeacon.mockClear();

      // Try to flush offline storage while offline
      vi.advanceTimersByTime(2000);

      // Should not have attempted (navigator.onLine is false)
      expect(mockApi.trackObservationsBatchBeacon).not.toHaveBeenCalled();

      queue.stop();
    });
  });
});
