import { createContext } from 'react';
import type { Flame, Variant } from '@cuped-io/flame';

/**
 * Internal context shared between {@link CupedProvider} and the
 * hooks/components in this package.
 *
 * `ready` turns true once flame's reads answer. From then on a hook
 * reads its arm from flame, and that read records the exposure
 * (flame#24).
 *
 * `edge` is the flame-edge answer from the provider's `prehydrated`
 * prop, keyed by experiment id and slug, or `null` without one. It
 * answers on the first render, including the server render, before
 * flame is ready.
 *
 * `timedOut` turns true when the loading limit passes before flame is
 * ready. `gaveUp` holds the experiments that then showed control: they
 * keep control for the rest of the page view and are never read, so
 * never recorded.
 */
export interface CupedContextValue {
  flame: Flame | null;
  ready: boolean;
  edge: Record<string, Variant> | null;
  timedOut: boolean;
  gaveUp: Set<string>;
}

export const CupedContext = createContext<CupedContextValue>({
  flame: null,
  ready: false,
  edge: null,
  timedOut: false,
  gaveUp: new Set(),
});
