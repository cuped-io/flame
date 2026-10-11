/**
 * React hydration awareness (flame#44, decided 2026-10-11).
 *
 * On a server-rendered React page, changing an element before React hydrates
 * it makes React throw recoverable error #418 (hydration mismatch) and
 * discard the change. So flame waits until React has hydrated every element a
 * variant targets, up to HYDRATION_TIMEOUT_MS.
 */

export const HYDRATION_POLL_MS = 50;
/** If React hasn't hydrated by then it most likely won't, so applying can't clash. */
export const HYDRATION_TIMEOUT_MS = 5_000;

/**
 * A server-rendered React framework's fingerprint, present before hydration.
 * A hand-built React SSR page has none; it looks like static HTML until React
 * runs, so it needs the `waitForHydration` opt-in.
 */
export function reactSsrDetected(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return (
    // Next.js: the app router streams its payload into self.__next_f; the
    // pages router inlines #__NEXT_DATA__.
    Array.isArray(w.__next_f) ||
    !!document.getElementById('__NEXT_DATA__') ||
    // Remix, and React Router 7 in framework mode.
    w.__remixContext !== undefined ||
    w.__reactRouterContext !== undefined ||
    // Gatsby renders into #___gatsby.
    !!document.getElementById('___gatsby')
  );
}

/**
 * React marks a hydrated element with an own `__reactFiber$<random>` key
 * (React 17+) or `__reactInternalInstance$<random>` (React 16). Internal,
 * but stable across those versions; it is the only per-element signal.
 */
function isHydratedByReact(el: Element): boolean {
  return Object.keys(el).some(
    (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  );
}

/** Every element these selectors match is hydrated, or absent. */
export function targetsHydrated(selectors: string[]): boolean {
  return selectors.every((selector) => {
    let el: Element | null;
    try {
      el = document.querySelector(selector);
    } catch {
      return true; // An invalid selector never applies; don't wait on it.
    }
    return !el || isHydratedByReact(el);
  });
}
