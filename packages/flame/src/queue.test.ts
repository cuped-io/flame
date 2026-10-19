import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventQueue, DEFAULT_BATCH_SIZE, DEFAULT_FLUSH_INTERVAL_MS } from './queue';
import { OfflineStorage } from './storage';
import type { CreateEventRequest } from './types';

// Mock ApiClient
const createMockApiClient = () => ({
  trackEventsBeacon: vi.fn().mockReturnValue(true),
  sendEvents: vi.fn().mockResolvedValue('sent'),
});

// Helper to create a test event
const createEvent = (eventType: string): CreateEventRequest => ({
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

describe('EventQueue', () => {
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
    it('should add events to the queue', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never);

      queue.enqueue(createEvent('pageview'));
      expect(queue.size()).toBe(1);

      queue.enqueue(createEvent('click'));
      expect(queue.size()).toBe(2);

      queue.stop();
    });

    it('sends with a fetch when the batch size is reached', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, { batchSize: 3 });

      queue.enqueue(createEvent('pageview'));
      queue.enqueue(createEvent('click'));
      expect(mockApi.sendEvents).not.toHaveBeenCalled();

      // Third event should trigger flush
      queue.enqueue(createEvent('add_to_cart'));
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);
      expect(mockApi.sendEvents).toHaveBeenCalledWith([
        createEvent('pageview'),
        createEvent('click'),
        createEvent('add_to_cart'),
      ]);
      expect(queue.size()).toBe(0);

      queue.stop();
    });
  });

  describe('flush', () => {
    it('should send all queued events', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, { batchSize: 100 });

      queue.enqueue(createEvent('pageview'));
      queue.enqueue(createEvent('click'));
      queue.flush();

      expect(mockApi.trackEventsBeacon).toHaveBeenCalledTimes(1);
      expect(mockApi.trackEventsBeacon).toHaveBeenCalledWith([
        createEvent('pageview'),
        createEvent('click'),
      ]);
      expect(queue.size()).toBe(0);

      queue.stop();
    });

    it('should do nothing when queue is empty', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never);

      queue.flush();
      expect(mockApi.trackEventsBeacon).not.toHaveBeenCalled();

      queue.stop();
    });

    // flame#46: an arm counts as recorded only once its record is sent.
    it("tells an event's sender once the browser accepts the batch carrying it", () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, { batchSize: 100 });
      const onSent = vi.fn();

      queue.enqueue(createEvent('$assignment'), onSent);
      expect(onSent).not.toHaveBeenCalled();
      queue.flush();
      expect(onSent).toHaveBeenCalledOnce();
      queue.flush();
      expect(onSent).toHaveBeenCalledOnce();

      queue.stop();
    });

    it('does not tell the sender when the browser refuses the batch', () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);
      const queue = new EventQueue(mockApi as never, { batchSize: 100 });
      const onSent = vi.fn();

      queue.enqueue(createEvent('$assignment'), onSent);
      queue.flush();
      expect(onSent).not.toHaveBeenCalled();

      queue.stop();
    });
  });

  describe('sending while the page is open', () => {
    it("tells an event's sender only once ember accepts the batch carrying it", async () => {
      const mockApi = createMockApiClient();
      let answer!: (delivery: string) => void;
      mockApi.sendEvents.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
      const queue = new EventQueue(mockApi as never, { flushIntervalMs: 1000, batchSize: 100 });
      const onSent = vi.fn();

      queue.enqueue(createEvent('$assignment'), onSent);
      await vi.advanceTimersByTimeAsync(1000);
      expect(onSent).not.toHaveBeenCalled();

      answer('sent');
      await vi.advanceTimersByTimeAsync(0);
      expect(onSent).toHaveBeenCalledOnce();

      queue.stop();
    });

    it.each(['retry', 'refused'])(
      'does not tell the sender when ember answers %s',
      async (delivery) => {
        const mockApi = createMockApiClient();
        mockApi.sendEvents.mockResolvedValue(delivery);
        const queue = new EventQueue(mockApi as never, { flushIntervalMs: 1000, batchSize: 100 });
        const onSent = vi.fn();

        queue.enqueue(createEvent('$assignment'), onSent);
        await vi.advanceTimersByTimeAsync(1000);
        expect(onSent).not.toHaveBeenCalled();

        queue.stop();
      }
    );
  });

  describe('page unload', () => {
    // A fetch's answer would arrive after the page is gone, so nothing could act on it.
    it('sends with a beacon when the page is hidden', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, { batchSize: 100 });

      queue.enqueue(createEvent('pageview'));
      window.dispatchEvent(new Event('pagehide'));

      expect(mockApi.trackEventsBeacon).toHaveBeenCalledWith([createEvent('pageview')]);
      expect(mockApi.sendEvents).not.toHaveBeenCalled();

      queue.stop();
    });
  });

  describe('timer-based flushing', () => {
    // flame#40: the page is still open, so send in a way that sees ember's answer.
    it('sends on the interval with a fetch, not a beacon', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, {
        flushIntervalMs: 1000,
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      expect(mockApi.sendEvents).not.toHaveBeenCalled();

      // Advance timer by flush interval
      vi.advanceTimersByTime(1000);
      expect(mockApi.sendEvents).toHaveBeenCalledWith([createEvent('pageview')]);
      expect(mockApi.trackEventsBeacon).not.toHaveBeenCalled();
      expect(queue.size()).toBe(0);

      queue.stop();
    });

    it('should flush multiple times on interval', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, {
        flushIntervalMs: 1000,
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      vi.advanceTimersByTime(1000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);

      queue.enqueue(createEvent('click'));
      vi.advanceTimersByTime(1000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(2);

      queue.stop();
    });
  });

  describe('stop', () => {
    it('should stop the timer', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, {
        flushIntervalMs: 1000,
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      queue.stop();

      // Timer should be stopped, so no flush
      vi.advanceTimersByTime(2000);
      expect(mockApi.sendEvents).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear the queue without flushing', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never);

      queue.enqueue(createEvent('pageview'));
      queue.enqueue(createEvent('click'));
      queue.clear();

      expect(queue.size()).toBe(0);
      expect(mockApi.sendEvents).not.toHaveBeenCalled();

      queue.stop();
    });
  });

  describe('size', () => {
    it('should return current queue size', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, { batchSize: 100 });

      expect(queue.size()).toBe(0);

      queue.enqueue(createEvent('pageview'));
      expect(queue.size()).toBe(1);

      queue.enqueue(createEvent('click'));
      expect(queue.size()).toBe(2);

      queue.flush();
      expect(queue.size()).toBe(0);

      queue.stop();
    });
  });

  describe('configuration', () => {
    it('should use custom batch size', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, { batchSize: 2 });

      queue.enqueue(createEvent('pageview'));
      expect(mockApi.sendEvents).not.toHaveBeenCalled();

      queue.enqueue(createEvent('click'));
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);

      queue.stop();
    });

    it('should use custom flush interval', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, {
        flushIntervalMs: 500,
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));

      vi.advanceTimersByTime(499);
      expect(mockApi.sendEvents).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);

      queue.stop();
    });
  });
});

describe('EventQueue offline behavior', () => {
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
      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        enableOfflineStorage: true,
      });

      expect(queue.getOfflineStorage()).not.toBeNull();
      queue.stop();
    });

    it('should not enable offline storage without DSN', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, {
        enableOfflineStorage: true,
      });

      expect(queue.getOfflineStorage()).toBeNull();
      queue.stop();
    });

    it('should not enable offline storage when explicitly disabled', () => {
      const mockApi = createMockApiClient();
      const queue = new EventQueue(mockApi as never, {
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
      mockApi.trackEventsBeacon.mockReturnValue(false);

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      queue.enqueue(createEvent('click'));
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
      mockApi.trackEventsBeacon.mockReturnValue(false);

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush();

      // In-memory queue should be empty
      expect(queue.size()).toBe(0);

      queue.stop();
    });
  });

  // flame#40: ember's answer decides whether a batch is kept.
  describe("ember's answer", () => {
    it('keeps a batch ember may take later, and retries it with a fetch', async () => {
      const mockApi = createMockApiClient();
      mockApi.sendEvents.mockResolvedValueOnce('retry').mockResolvedValue('sent');
      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 60000,
      });

      queue.enqueue(createEvent('pageview'));
      await vi.advanceTimersByTimeAsync(60000);
      expect(queue.getOfflineStorage()?.count()).toBe(1);

      await vi.advanceTimersByTimeAsync(2000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(2);
      expect(mockApi.sendEvents).toHaveBeenLastCalledWith([createEvent('pageview')]);
      expect(mockApi.trackEventsBeacon).not.toHaveBeenCalled();
      expect(queue.getOfflineStorage()?.count()).toBe(0);

      queue.stop();
    });

    it('drops a batch ember refuses, since sending it again cannot help', async () => {
      const mockApi = createMockApiClient();
      mockApi.sendEvents.mockResolvedValue('refused');
      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 60000,
      });

      queue.enqueue(createEvent('pageview'));
      await vi.advanceTimersByTimeAsync(60000);
      expect(queue.getOfflineStorage()?.count()).toBe(0);

      await vi.advanceTimersByTimeAsync(59000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);

      queue.stop();
    });
  });

  // A batch the browser would not take as a beacon is kept, then retried with a fetch.
  describe('retry with exponential backoff', () => {
    it('should schedule retry after flush failure', async () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);
      mockApi.sendEvents.mockResolvedValue('retry');

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush();
      expect(mockApi.sendEvents).not.toHaveBeenCalled();

      // Advance time to trigger retry (base delay is 1s + jitter)
      await vi.advanceTimersByTimeAsync(2000);

      // Should have attempted retry
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);
      expect(mockApi.sendEvents).toHaveBeenCalledWith([createEvent('pageview')]);

      queue.stop();
    });

    it('should use exponential backoff for retries', async () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);
      mockApi.sendEvents.mockResolvedValue('retry');

      // Use a long flush interval to avoid interference from timer-based flushes
      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 60000, // 1 minute - won't trigger during test
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush(); // Initial flush (fails)

      // First retry at ~1s (base delay + jitter up to 1s = up to 2s)
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);

      // Second retry at ~2s base + jitter (exponential: 2^1 * 1000 = 2000ms + up to 1s jitter)
      await vi.advanceTimersByTimeAsync(3000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(2);

      // Third retry at ~4s base + jitter (exponential: 2^2 * 1000 = 4000ms + up to 1s jitter)
      await vi.advanceTimersByTimeAsync(6000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(3);

      queue.stop();
    });

    it('should cap retry delay at 30 seconds', async () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);
      mockApi.sendEvents.mockResolvedValue('retry');

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 600000,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush();

      // Trigger many retries
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(35000); // More than max delay
      }

      // All retries should have happened (not stuck waiting for longer delays)
      expect(mockApi.sendEvents.mock.calls.length).toBeGreaterThan(5);

      queue.stop();
    });

    it('does not let the flush interval cut a backoff short', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0); // no jitter
      const mockApi = createMockApiClient();
      mockApi.sendEvents.mockResolvedValue('retry');

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 1000,
      });

      queue.enqueue(createEvent('pageview'));
      // Sent at 1s, then retried after 1s, 2s and 4s: at 2s, 4s and 8s.
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(4);

      queue.stop();
      vi.mocked(Math.random).mockRestore();
    });

    it('keeps the first timestamp of an event it retries, so the TTL still expires it', async () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);
      mockApi.sendEvents.mockResolvedValue('retry');

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 600000,
        offlineTtlMs: 60000,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush();
      await vi.advanceTimersByTimeAsync(2000);
      expect(queue.getOfflineStorage()?.count()).toBe(1);

      await vi.advanceTimersByTimeAsync(60000);
      expect(queue.getOfflineStorage()?.count()).toBe(0);

      queue.stop();
    });
  });

  // Consent withdrawal (flame#18) stops, clears and empties the store while a send may be in flight.
  describe('stopping while a send is in flight', () => {
    it.each(['a queued batch', 'a kept batch'])(
      'neither keeps %s nor sends again when the answer says retry',
      async (batch) => {
        const mockApi = createMockApiClient();
        let answer!: (delivery: string) => void;
        mockApi.sendEvents.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
        if (batch === 'a kept batch') mockApi.trackEventsBeacon.mockReturnValueOnce(false);
        const queue = new EventQueue(mockApi as never, {
          dsn: 'test-dsn',
          batchSize: 100,
          flushIntervalMs: 1000,
        });

        queue.enqueue(createEvent('pageview'));
        if (batch === 'a kept batch') queue.flush();
        await vi.advanceTimersByTimeAsync(2000); // the send, or the retry of the kept batch, is in flight
        expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);

        queue.stop();
        queue.clear();
        queue.getOfflineStorage()?.clear();
        answer('retry');
        await vi.advanceTimersByTimeAsync(60000);

        expect(queue.getOfflineStorage()?.count()).toBe(0);
        expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe('page unload', () => {
    it('leaves kept events for the next page load, where a failed send can be seen', () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValueOnce(false);
      mockApi.sendEvents.mockReturnValue(new Promise(() => {}));
      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 600000,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush(); // the beacon fails: kept
      queue.flush(); // the page unloads with nothing queued

      expect(mockApi.sendEvents).not.toHaveBeenCalled();
      expect(queue.getOfflineStorage()?.count()).toBe(1);

      queue.stop();
    });
  });

  describe('online event handler', () => {
    it('should flush offline storage when coming back online', () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush(); // This fails and persists

      const storage = queue.getOfflineStorage();
      expect(storage?.count()).toBe(1);

      // Simulate going online
      onlineHandlers.forEach((h) => h());

      // Should have tried to flush
      expect(mockApi.sendEvents).toHaveBeenCalledWith([createEvent('pageview')]);

      queue.stop();
    });
  });

  describe('flush offline storage on initialization', () => {
    it('should attempt to flush previously stored events on start', () => {
      const mockApi = createMockApiClient();

      // Pre-populate storage with events
      const now = Date.now();
      const storedData = [{ event: createEvent('previous'), timestamp: now - 1000 }];
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
      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      // Should have flushed the stored event
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);
      expect(mockApi.sendEvents).toHaveBeenCalledWith([createEvent('previous')]);
      expect(mockApi.trackEventsBeacon).not.toHaveBeenCalled();

      queue.stop();
    });

    // A keepalive fetch over ~64 KB is refused, so a drain sends one batch at a time.
    it('sends stored events one batch at a time', async () => {
      const mockApi = createMockApiClient();
      const storage = new OfflineStorage('test-dsn');
      storage.save([createEvent('a'), createEvent('b'), createEvent('c')]);

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 2,
        flushIntervalMs: 1000,
      });
      expect(mockApi.sendEvents).toHaveBeenLastCalledWith([createEvent('a'), createEvent('b')]);

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockApi.sendEvents).toHaveBeenLastCalledWith([createEvent('c')]);
      expect(storage.count()).toBe(0);

      queue.stop();
    });
  });

  describe('clear storage on successful send', () => {
    it('should clear offline storage after successful flush', async () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush(); // Fails and persists

      const storage = queue.getOfflineStorage();
      expect(storage?.count()).toBe(1);

      // Trigger retry (should succeed)
      await vi.advanceTimersByTimeAsync(2000);

      // Storage should be cleared
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(1);
      expect(storage?.count()).toBe(0);

      queue.stop();
    });

    it('keeps a stored event while its send is in flight, in case the page closes first', async () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);
      mockApi.sendEvents.mockReturnValue(new Promise(() => {}));

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 600000,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush();
      await vi.advanceTimersByTimeAsync(2000);

      expect(mockApi.sendEvents).toHaveBeenCalledOnce();
      expect(queue.getOfflineStorage()?.load()).toEqual([createEvent('pageview')]);

      queue.stop();
    });

    it('keeps events saved while a retry is in flight', async () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);
      let answer!: (delivery: string) => void;
      mockApi.sendEvents.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 600000,
      });

      queue.enqueue(createEvent('first'));
      queue.flush();
      await vi.advanceTimersByTimeAsync(2000); // retry of 'first' now in flight

      queue.enqueue(createEvent('second'));
      queue.flush(); // the beacon fails again: 'second' is saved

      answer('sent');
      await vi.advanceTimersByTimeAsync(0);
      expect(queue.getOfflineStorage()?.load()).toEqual([createEvent('second')]);

      queue.stop();
    });

    it('should reset retry attempt counter on success', async () => {
      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);
      // Fail once, then succeed
      mockApi.sendEvents.mockResolvedValueOnce('retry').mockResolvedValue('sent');

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
        flushIntervalMs: 600000,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush(); // Fails

      // First retry (fails)
      await vi.advanceTimersByTimeAsync(2000);

      // Second retry (succeeds)
      await vi.advanceTimersByTimeAsync(3000);

      const storage = queue.getOfflineStorage();
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(2);
      expect(storage?.count()).toBe(0);

      // Add more events and fail again
      queue.enqueue(createEvent('new-event'));
      queue.flush();

      // Next retry should start from base delay (1s), not continue exponential
      await vi.advanceTimersByTimeAsync(2000);
      expect(mockApi.sendEvents).toHaveBeenCalledTimes(3);

      queue.stop();
    });
  });

  describe('offline detection', () => {
    it('should not attempt flush when navigator.onLine is false', async () => {
      vi.stubGlobal('navigator', { onLine: false, sendBeacon: vi.fn() });

      const mockApi = createMockApiClient();
      mockApi.trackEventsBeacon.mockReturnValue(false);

      const queue = new EventQueue(mockApi as never, {
        dsn: 'test-dsn',
        batchSize: 100,
      });

      queue.enqueue(createEvent('pageview'));
      queue.flush(); // Fails and persists

      // Try to flush offline storage while offline
      await vi.advanceTimersByTimeAsync(2000);

      // Should not have attempted (navigator.onLine is false)
      expect(mockApi.sendEvents).not.toHaveBeenCalled();

      queue.stop();
    });
  });
});
