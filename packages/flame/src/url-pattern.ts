/**
 * An experiment's page targeting (flame#50). The syntax is the goals'
 * `url_pattern`, ported from ember's `goal_matching.rs` so flame and ember
 * agree on which pages match:
 *
 * - `/exact/path`: that path
 * - `/path/*`: one segment (`/path/foo`, not `/path/foo/bar`)
 * - `/path/**`: the path itself or anything beneath it
 * - `**` then `/suffix`: the suffix itself or anything ending in it
 *
 * Trailing slashes are ignored, on the pattern and the path.
 */
export function matchesUrlPattern(pattern: string, path: string): boolean {
  const normalizedPattern = normalizePath(pattern);
  const normalizedPath = normalizePath(path);

  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  if (normalizedPattern.startsWith('**/')) {
    const suffix = normalizedPattern.slice(3);
    return normalizedPath === suffix || normalizedPath.endsWith(`/${suffix}`);
  }

  let source = '^';
  for (let i = 0; i < normalizedPattern.length; i++) {
    const c = normalizedPattern[i];
    if (c === '*') {
      if (normalizedPattern[i + 1] === '*') {
        i++;
        source += '.*';
      } else {
        source += '[^/]+';
      }
    } else {
      source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`).test(normalizedPath);
}

/** Strips trailing slashes, except on the root. */
function normalizePath(path: string): string {
  return path === '/' ? '/' : path.replace(/\/+$/, '');
}

/** Whether the experiment runs on the current page. No pattern: every page. */
export function runsOnThisPage(experiment: { url_pattern?: string | null }): boolean {
  if (!experiment.url_pattern) return true;
  if (typeof window === 'undefined') return false;
  return matchesUrlPattern(experiment.url_pattern, window.location.pathname);
}
