import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { collectContext, collectMinimalContext } from './context';
import type { UserContext } from './context';

describe('context', () => {
  // Store original values
  const originalNavigator = global.navigator;
  const originalWindow = global.window;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Restore originals
    Object.defineProperty(global, 'navigator', { value: originalNavigator, writable: true });
    Object.defineProperty(global, 'window', { value: originalWindow, writable: true });
  });

  describe('collectContext', () => {
    it('should return a complete UserContext object', () => {
      const context = collectContext();

      expect(context).toHaveProperty('deviceType');
      expect(context).toHaveProperty('browser');
      expect(context).toHaveProperty('os');
      expect(context).toHaveProperty('viewport');
      expect(context).toHaveProperty('pixelRatio');
      expect(context).toHaveProperty('language');
      expect(context).toHaveProperty('timezoneOffset');
      expect(context).toHaveProperty('connection');
      expect(context).toHaveProperty('touchSupported');
      expect(context).toHaveProperty('cookiesEnabled');
    });

    it('should detect device type from user agent', () => {
      const testCases: Array<{ ua: string; expected: UserContext['deviceType'] }> = [
        { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)', expected: 'mobile' },
        {
          ua: 'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 Mobile',
          expected: 'mobile',
        },
        { ua: 'Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X)', expected: 'tablet' },
        { ua: 'Mozilla/5.0 (Linux; Android 10; SM-T865) AppleWebKit/537.36', expected: 'tablet' },
        { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', expected: 'desktop' },
        { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', expected: 'desktop' },
      ];

      for (const { ua, expected } of testCases) {
        Object.defineProperty(global, 'navigator', {
          value: { ...originalNavigator, userAgent: ua },
          writable: true,
        });
        const context = collectContext();
        expect(context.deviceType).toBe(expected);
      }
    });

    it('should detect browser from user agent', () => {
      const testCases: Array<{ ua: string; expected: string }> = [
        { ua: 'Mozilla/5.0 Chrome/91.0.4472.124 Safari/537.36', expected: 'chrome' },
        { ua: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15', expected: 'safari' },
        { ua: 'Mozilla/5.0 Firefox/89.0', expected: 'firefox' },
        { ua: 'Mozilla/5.0 Chrome/91.0 Safari/537.36 Edg/91.0.864.59', expected: 'edge' },
        { ua: 'Mozilla/5.0 Chrome/91.0 Safari/537.36 OPR/77.0', expected: 'opera' },
      ];

      for (const { ua, expected } of testCases) {
        Object.defineProperty(global, 'navigator', {
          value: { ...originalNavigator, userAgent: ua },
          writable: true,
        });
        const context = collectContext();
        expect(context.browser).toBe(expected);
      }
    });

    it('should detect OS from user agent', () => {
      const testCases: Array<{ ua: string; expected: string }> = [
        { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', expected: 'windows' },
        { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', expected: 'macos' },
        { ua: 'Mozilla/5.0 (X11; Linux x86_64)', expected: 'linux' },
        { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)', expected: 'ios' },
        { ua: 'Mozilla/5.0 (Linux; Android 10; SM-G975F)', expected: 'android' },
        { ua: 'Mozilla/5.0 (X11; CrOS x86_64 14092.77.0)', expected: 'chromeos' },
      ];

      for (const { ua, expected } of testCases) {
        Object.defineProperty(global, 'navigator', {
          value: { ...originalNavigator, userAgent: ua },
          writable: true,
        });
        const context = collectContext();
        expect(context.os).toBe(expected);
      }
    });

    it('should classify viewport into buckets', () => {
      const testCases: Array<{ width: number; expected: UserContext['viewport'] }> = [
        { width: 320, expected: 'small' },
        { width: 575, expected: 'small' },
        { width: 576, expected: 'medium' },
        { width: 991, expected: 'medium' },
        { width: 992, expected: 'large' },
        { width: 1399, expected: 'large' },
        { width: 1400, expected: 'xlarge' },
        { width: 1920, expected: 'xlarge' },
      ];

      for (const { width, expected } of testCases) {
        Object.defineProperty(global, 'window', {
          value: { ...originalWindow, innerWidth: width },
          writable: true,
        });
        const context = collectContext();
        expect(context.viewport).toBe(expected);
      }
    });

    it('should capture pixel ratio', () => {
      Object.defineProperty(global, 'window', {
        value: { ...originalWindow, devicePixelRatio: 2 },
        writable: true,
      });
      const context = collectContext();
      expect(context.pixelRatio).toBe(2);
    });

    it('should capture language', () => {
      Object.defineProperty(global, 'navigator', {
        value: { ...originalNavigator, language: 'fr-FR' },
        writable: true,
      });
      const context = collectContext();
      expect(context.language).toBe('fr-FR');
    });

    it('should capture timezone offset', () => {
      const context = collectContext();
      expect(typeof context.timezoneOffset).toBe('number');
      // Timezone offset should be within valid range (-720 to +840 minutes)
      expect(context.timezoneOffset).toBeGreaterThanOrEqual(-720);
      expect(context.timezoneOffset).toBeLessThanOrEqual(840);
    });

    it('should detect connection type when available', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          ...originalNavigator,
          connection: { effectiveType: '4g' },
        },
        writable: true,
      });
      const context = collectContext();
      expect(context.connection).toBe('4g');
    });

    it('should return unknown connection when not available', () => {
      Object.defineProperty(global, 'navigator', {
        value: { ...originalNavigator, connection: undefined },
        writable: true,
      });
      const context = collectContext();
      expect(context.connection).toBe('unknown');
    });

    it('should detect touch support', () => {
      // Test with touch support via maxTouchPoints
      Object.defineProperty(global, 'navigator', {
        value: { ...originalNavigator, maxTouchPoints: 5 },
        writable: true,
      });
      const context = collectContext();
      expect(context.touchSupported).toBe(true);
    });

    it('should return boolean for touchSupported', () => {
      const context = collectContext();
      expect(typeof context.touchSupported).toBe('boolean');
    });

    it('should detect cookies enabled', () => {
      Object.defineProperty(global, 'navigator', {
        value: { ...originalNavigator, cookieEnabled: true },
        writable: true,
      });
      let context = collectContext();
      expect(context.cookiesEnabled).toBe(true);

      Object.defineProperty(global, 'navigator', {
        value: { ...originalNavigator, cookieEnabled: false },
        writable: true,
      });
      context = collectContext();
      expect(context.cookiesEnabled).toBe(false);
    });
  });

  describe('collectMinimalContext', () => {
    it('should return only essential fields', () => {
      const context = collectMinimalContext();

      // Should have these fields
      expect(context).toHaveProperty('deviceType');
      expect(context).toHaveProperty('browser');
      expect(context).toHaveProperty('os');
      expect(context).toHaveProperty('viewport');

      // Should NOT have these fields
      expect(context).not.toHaveProperty('pixelRatio');
      expect(context).not.toHaveProperty('language');
      expect(context).not.toHaveProperty('timezoneOffset');
      expect(context).not.toHaveProperty('connection');
      expect(context).not.toHaveProperty('touchSupported');
      expect(context).not.toHaveProperty('cookiesEnabled');
    });

    it('should detect the same values as full context', () => {
      const full = collectContext();
      const minimal = collectMinimalContext();

      expect(minimal.deviceType).toBe(full.deviceType);
      expect(minimal.browser).toBe(full.browser);
      expect(minimal.os).toBe(full.os);
      expect(minimal.viewport).toBe(full.viewport);
    });
  });
});
