import { createContext } from 'react';
import type { Flame, Variant } from '@cuped-io/flame';

/**
 * Internal context shared between {@link CupedProvider} and the
 * hooks/components in this package.
 *
 * `assignments` is the synchronous variant map, keyed by
 * experiment id. Populated from the provider's `prehydrated` prop
 * on first render (so SSR + hydration produce the right variant
 * without a flash) and re-synced from flame after `init()` resolves.
 *
 * `initTick` increments whenever the underlying flame instance
 * transitions from "initializing" to "initialized" (or is reset).
 * Hook consumers depend on it via `useContext` so React schedules
 * a re-render at the moment assignments become available.
 */
export interface CupedContextValue {
  flame: Flame | null;
  initialized: boolean;
  initTick: number;
  assignments: Record<string, Variant>;
}

export const CupedContext = createContext<CupedContextValue>({
  flame: null,
  initialized: false,
  initTick: 0,
  assignments: {},
});
