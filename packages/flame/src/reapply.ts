import { applyVariant } from './apply';
import type { Variant } from './types';

/**
 * Re-apply on DOM change (flame#45, decided 2026-10-11).
 *
 * flame applies at init, so a target a framework re-creates (a remount,
 * client-side navigation away and back) loses its variant. The watcher
 * applies a variant's changes to any target that appears without flame's
 * data-flame-modified marker.
 *
 * - Fresh targets only: a varied element the site later changes keeps its
 *   marker, and the site's change.
 * - Redirects are never re-applied (they have no selector).
 * - Loop guard: more than REAPPLY_LIMIT re-applies to one selector within
 *   REAPPLY_WINDOW_MS is a site fighting flame, not navigation; flame stops
 *   re-applying that selector and warns.
 */

const REAPPLY_LIMIT = 10;
const REAPPLY_WINDOW_MS = 1_000;

export function watchForFreshTargets(
  activeVariants: () => Variant[],
  debug: boolean | undefined
): { stop: () => void } {
  const reapplyTimes = new Map<string, number[]>();
  const givenUp = new Set<string>();

  const noteReapply = (selector: string) => {
    const now = Date.now();
    const recent = (reapplyTimes.get(selector) ?? []).filter((t) => now - t < REAPPLY_WINDOW_MS);
    recent.push(now);
    reapplyTimes.set(selector, recent);
    if (recent.length > REAPPLY_LIMIT) {
      givenUp.add(selector);
      console.warn(
        `[Flame] Stopped re-applying to "${selector}": the page re-created it ${recent.length} times in ${REAPPLY_WINDOW_MS}ms after flame changed it.`
      );
    }
  };

  const isFresh = (selector: string): boolean => {
    if (givenUp.has(selector)) return false;
    let el: Element | null;
    try {
      el = document.querySelector(selector);
    } catch {
      return false;
    }
    return !!el && !el.hasAttribute('data-flame-modified');
  };

  const observer = new MutationObserver(() => {
    for (const variant of activeVariants()) {
      const fresh = (variant.changes ?? []).filter((c) => 'selector' in c && isFresh(c.selector));
      if (fresh.length === 0) continue;
      for (const c of fresh) {
        if ('selector' in c) noteReapply(c.selector);
      }
      try {
        applyVariant({ ...variant, changes: fresh }, debug);
      } catch (error) {
        console.warn(`[Flame] Failed to re-apply variant ${variant.id}:`, error);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return { stop: () => observer.disconnect() };
}
