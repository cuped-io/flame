/**
 * URL pattern matching utility for pageview goals
 *
 * Supports glob-style patterns:
 * - `*` matches a single path segment (no slashes)
 * - `**` matches any number of path segments (including zero)
 *
 * Examples:
 * - `/product/*` matches `/product/123` but not `/product/123/details`
 * - `/checkout/**` matches `/checkout`, `/checkout/step1`, `/checkout/a/b`
 * - `/about` matches only `/about`
 */

/**
 * Check if a URL path matches a glob-style pattern
 *
 * @param pattern - The pattern to match against (e.g., "/product/*")
 * @param path - The URL path to test (e.g., "/product/123")
 * @returns true if the path matches the pattern
 */
export function matchUrlPattern(pattern: string, path: string): boolean {
  // Normalize paths: remove trailing slashes (except for root)
  const normalizedPattern = pattern === '/' ? '/' : pattern.replace(/\/+$/, '');
  const normalizedPath = path === '/' ? '/' : path.replace(/\/+$/, '');

  // Handle special case: pattern ends with /** (match zero or more segments)
  // /checkout/** should match /checkout, /checkout/step1, /checkout/a/b
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3); // Remove /**
    const escapedPrefix = prefix.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Replace any remaining * with single segment matcher
    const regexPrefix = escapedPrefix.replace(/\*/g, '[^/]+');
    try {
      // Match prefix exactly, then optionally / followed by anything
      const regex = new RegExp(`^${regexPrefix}(/.*)?$`);
      return regex.test(normalizedPath);
    } catch {
      return false;
    }
  }

  // Handle special case: pattern starts with **/ (match zero or more preceding segments)
  if (normalizedPattern.startsWith('**/')) {
    const suffix = normalizedPattern.slice(3); // Remove **/
    const escapedSuffix = suffix.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    // Replace any remaining * with single segment matcher
    const regexSuffix = escapedSuffix.replace(/\*/g, '[^/]+');
    try {
      // Match anything (including empty) followed by the suffix
      const regex = new RegExp(`^(.*/)?${regexSuffix}$`);
      return regex.test(normalizedPath);
    } catch {
      return false;
    }
  }

  // Build regex from pattern:
  // 1. Escape regex special characters (except * which we handle)
  // 2. Replace ** with a placeholder first (to distinguish from single *)
  // 3. Replace * with single-segment matcher
  // 4. Replace ** placeholder with multi-segment matcher

  const regexPattern = normalizedPattern
    // Escape regex special characters except *
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    // Replace ** with a unique placeholder
    .replace(/\*\*/g, '<<<DOUBLE_STAR>>>')
    // Replace single * with pattern matching one path segment (no slashes)
    .replace(/\*/g, '[^/]+')
    // Replace ** placeholder with pattern matching any path segments (including /)
    .replace(/<<<DOUBLE_STAR>>>/g, '.*');

  try {
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  } catch {
    // Invalid pattern - return false
    return false;
  }
}
