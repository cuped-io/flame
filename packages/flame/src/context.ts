/**
 * Device context collection for segment-level CUPED
 *
 * When individual-level CUPED isn't possible (new users, session-only identity),
 * we can still reduce variance by adjusting for device characteristics.
 */

/**
 * Device type classification
 */
export type DeviceType = 'mobile' | 'tablet' | 'desktop';

/**
 * Viewport size bucket
 */
export type ViewportBucket = 'small' | 'medium' | 'large' | 'xlarge';

/**
 * Connection type (when available)
 */
export type ConnectionType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';

/**
 * User context for segment-level variance reduction
 *
 * These characteristics correlate with user behavior and can be used
 * as covariates when individual pre-period data isn't available.
 */
export interface UserContext {
  /** Device type classification */
  deviceType: DeviceType;
  /** Browser family (chrome, safari, firefox, edge, other) */
  browser: string;
  /** Operating system family (windows, macos, linux, ios, android, other) */
  os: string;
  /** Viewport size bucket */
  viewport: ViewportBucket;
  /** Screen pixel density (1, 2, 3, etc.) */
  pixelRatio: number;
  /** Browser language */
  language: string;
  /** Timezone offset in minutes */
  timezoneOffset: number;
  /** Connection type if available */
  connection: ConnectionType;
  /** Whether touch is supported */
  touchSupported: boolean;
  /** Whether cookies are enabled */
  cookiesEnabled: boolean;
}

/**
 * Detect the device type from user agent
 */
function detectDeviceType(ua: string): DeviceType {
  // Check for tablets first (they often have "mobile" in UA too)
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) {
    return 'tablet';
  }

  // Check for mobile
  if (/Mobile|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i.test(ua)) {
    return 'mobile';
  }

  return 'desktop';
}

/**
 * Detect browser family from user agent
 */
function detectBrowser(ua: string): string {
  // Order matters - check more specific patterns first
  if (/Edg\//i.test(ua)) return 'edge';
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'opera';
  if (/Firefox\//i.test(ua)) return 'firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'safari';
  if (/Chrome\//i.test(ua)) return 'chrome';
  return 'other';
}

/**
 * Detect operating system from user agent
 */
function detectOS(ua: string): string {
  // Check iOS before macOS (iOS UAs contain "Mac OS X")
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/CrOS/i.test(ua)) return 'chromeos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

/**
 * Classify viewport width into buckets
 */
function classifyViewport(width: number): ViewportBucket {
  if (width < 576) return 'small';
  if (width < 992) return 'medium';
  if (width < 1400) return 'large';
  return 'xlarge';
}

/**
 * Get connection type from Network Information API
 */
function getConnectionType(): ConnectionType {
  // Network Information API (not available in all browsers)
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
    };
  };

  const effectiveType = nav.connection?.effectiveType;

  switch (effectiveType) {
    case 'slow-2g':
      return 'slow-2g';
    case '2g':
      return '2g';
    case '3g':
      return '3g';
    case '4g':
      return '4g';
    default:
      return 'unknown';
  }
}

/**
 * Check if touch is supported
 */
function isTouchSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }

  const msNav = navigator as Navigator & { msMaxTouchPoints?: number };

  return (
    'ontouchstart' in window || navigator.maxTouchPoints > 0 || (msNav.msMaxTouchPoints ?? 0) > 0
  );
}

/**
 * Collect user context for segment-level CUPED
 *
 * This information is sent with assignments and events to enable
 * variance reduction even for users without pre-period data.
 */
export function collectContext(): UserContext {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  return {
    deviceType: detectDeviceType(ua),
    browser: detectBrowser(ua),
    os: detectOS(ua),
    viewport: classifyViewport(typeof window !== 'undefined' ? window.innerWidth : 1024),
    pixelRatio: typeof window !== 'undefined' ? Math.round(window.devicePixelRatio || 1) : 1,
    language: typeof navigator !== 'undefined' ? navigator.language || 'en' : 'en',
    timezoneOffset: new Date().getTimezoneOffset(),
    connection: getConnectionType(),
    touchSupported: isTouchSupported(),
    cookiesEnabled: typeof navigator !== 'undefined' ? navigator.cookieEnabled : true,
  };
}

/**
 * Get a minimal context object for bandwidth-constrained situations
 */
export function collectMinimalContext(): Pick<
  UserContext,
  'deviceType' | 'browser' | 'os' | 'viewport'
> {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';

  return {
    deviceType: detectDeviceType(ua),
    browser: detectBrowser(ua),
    os: detectOS(ua),
    viewport: classifyViewport(typeof window !== 'undefined' ? window.innerWidth : 1024),
  };
}
