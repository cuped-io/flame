import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ApiClient } from './api';

describe('ApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should prepend API key to path', () => {
      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ experiments: [] })),
      });

      client.getActiveExperiments();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cuped.io/pk_live_abc123/experiments/active',
        expect.any(Object)
      );
    });

    it('should not include X-API-Key header', async () => {
      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ experiments: [] })),
      });

      await client.getActiveExperiments();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });
  });

  describe('getActiveExperiments', () => {
    it('should fetch active experiments', async () => {
      const mockResponse = {
        experiments: [
          {
            id: 'exp-1',
            project_id: 'project-123',
            name: 'Test Experiment',
            status: 'running',
            variants: [],
          },
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const result = await client.getActiveExperiments();

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cuped.io/pk_live_abc123/experiments/active',
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          body: undefined,
        }
      );
    });

    it('should throw error on failed request', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');

      await expect(client.getActiveExperiments()).rejects.toThrow(
        'API request failed: 500 Internal Server Error'
      );
    });
  });

  describe('assignVariant', () => {
    it('should request variant assignment', async () => {
      const mockResponse = {
        assignment_id: 'assign-1',
        experiment_id: 'exp-1',
        variant_id: 'variant-1',
        variant_name: 'Control',
        is_control: true,
        assigned_at: '2024-01-01T00:00:00Z',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const result = await client.assignVariant('exp-1', 'user-123');

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cuped.io/pk_live_abc123/experiments/exp-1/assign',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: 'user-123' }),
        }
      );
    });

    it('should include context when provided', async () => {
      const mockResponse = {
        assignment_id: 'assign-1',
        experiment_id: 'exp-1',
        variant_id: 'variant-1',
        variant_name: 'Control',
        is_control: true,
        assigned_at: '2024-01-01T00:00:00Z',
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const context = {
        deviceType: 'mobile' as const,
        browser: 'chrome',
        os: 'android',
        viewport: 'small' as const,
        pixelRatio: 2,
        language: 'en-US',
        timezoneOffset: -480,
        connection: 'unknown' as const,
        touchSupported: true,
        cookiesEnabled: true,
      };
      await client.assignVariant('exp-1', 'user-123', context);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cuped.io/pk_live_abc123/experiments/exp-1/assign',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: 'user-123', context }),
        }
      );
    });

    it('should throw error on failed assignment', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Experiment not found'),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');

      await expect(client.assignVariant('exp-1', 'user-123')).rejects.toThrow(
        'API request failed: 404 Experiment not found'
      );
    });
  });

  describe('debug mode', () => {
    it('should log requests when debug is enabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ experiments: [] })),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io', true);
      await client.getActiveExperiments();

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should not log when debug is disabled', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ experiments: [] })),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io', false);
      await client.getActiveExperiments();

      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('empty response handling', () => {
    it('should handle empty response body', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const result = await client.linkIdentity('user-123', 'device-456', 'device');

      // Should return empty object for empty response
      expect(result).toEqual({});
    });
  });

  describe('trackObservationBeacon', () => {
    it('should send observation using sendBeacon', () => {
      const sendBeaconMock = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, 'sendBeacon', {
        value: sendBeaconMock,
        writable: true,
        configurable: true,
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const result = client.trackObservationBeacon('user-123', 'pageview');

      expect(result).toBe(true);
      expect(sendBeaconMock).toHaveBeenCalledWith(
        'https://api.cuped.io/pk_live_abc123/observations',
        expect.any(Blob)
      );
    });

    it('should include metadata in beacon payload', () => {
      const sendBeaconMock = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, 'sendBeacon', {
        value: sendBeaconMock,
        writable: true,
        configurable: true,
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const metadata = { path: '/product/123', value: 49.99 };
      client.trackObservationBeacon('user-123', 'add_to_cart', metadata);

      expect(sendBeaconMock).toHaveBeenCalled();
      // Verify the Blob contains correct data
      const blobArg = sendBeaconMock.mock.calls[0][1] as Blob;
      expect(blobArg.type).toBe('text/plain');
    });

    it('should include experiment assignments in beacon payload', () => {
      const sendBeaconMock = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, 'sendBeacon', {
        value: sendBeaconMock,
        writable: true,
        configurable: true,
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const assignments = [{ experiment_id: 'exp-1', variant_id: 'variant-1' }];
      client.trackObservationBeacon('user-123', 'purchase', { order_id: '123' }, assignments);

      expect(sendBeaconMock).toHaveBeenCalled();
    });

    it('should fall back to fetch when sendBeacon is not available', () => {
      // @ts-expect-error - intentionally testing missing sendBeacon
      delete navigator.sendBeacon;

      fetchMock.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const result = client.trackObservationBeacon('user-123', 'pageview');

      expect(result).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.cuped.io/pk_live_abc123/observations',
        expect.objectContaining({
          method: 'POST',
          keepalive: true,
        })
      );
    });

    it('should return false when sendBeacon fails', () => {
      const sendBeaconMock = vi.fn().mockReturnValue(false);
      Object.defineProperty(navigator, 'sendBeacon', {
        value: sendBeaconMock,
        writable: true,
        configurable: true,
      });

      const client = new ApiClient('pk_live_abc123', 'https://api.cuped.io');
      const result = client.trackObservationBeacon('user-123', 'pageview');

      expect(result).toBe(false);
    });
  });
});
