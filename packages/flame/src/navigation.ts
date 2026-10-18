/**
 * URL changes without a page load (flame#50): a single-page app's
 * `history.pushState`/`replaceState`, and back/forward (`popstate`).
 *
 * `history` is wrapped once per page and never unwrapped, since another
 * script may have wrapped it after flame. `stop` only removes the listener.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let wrapped = false;

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[Flame] URL change handler failed:', error);
    }
  }
}

function wrapHistory(): void {
  if (wrapped) return;
  wrapped = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      notify();
      return result;
    };
  }
  window.addEventListener('popstate', notify);
}

/** Calls `onChange` when the path changes without a page load. */
export function watchPathChanges(onChange: () => void): { stop: () => void } {
  let last = window.location.pathname;
  const listener = () => {
    const path = window.location.pathname;
    if (path === last) return;
    last = path;
    onChange();
  };
  wrapHistory();
  listeners.add(listener);
  return { stop: () => listeners.delete(listener) };
}
