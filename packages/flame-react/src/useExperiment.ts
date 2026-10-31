import { useContext, useMemo } from 'react';
import { CupedContext } from './context';
import type { UseExperimentResult } from './types';

const CONTROL: UseExperimentResult = { variant: null, isLoading: false };
const LOADING: UseExperimentResult = { variant: null, isLoading: true };

/**
 * Subscribe to the user's assigned variant for an experiment.
 *
 * ```tsx
 * function HeroCTA() {
 *   const { variant, isLoading } = useExperiment('hero-cta');
 *   if (isLoading) return <Skeleton />;
 *   return variant?.name === 'green'
 *     ? <Button color="green">Save 30%</Button>
 *     : <Button color="blue">Get started</Button>;
 * }
 * ```
 *
 * `key` is the experiment's slug or id. `variant` is the variant to
 * show (id, name, is_control), or `null` for control. The arm is there
 * on the first render when flame already knows it: a flame-edge answer
 * passed to the provider as `prehydrated`, or flame already ready.
 * Otherwise `isLoading` is true until flame learns the arm or the
 * provider's `loadingLimitMs` passes (default 200 ms). After the limit
 * this experiment shows control for the rest of the page view, even if
 * the arm arrives later.
 *
 * Rendering the hook is what counts the visitor in the experiment
 * (flame#24): the first read of a real arm records it. Control shown
 * after the limit records nothing.
 *
 * Must be rendered inside a {@link CupedProvider}.
 */
export function useExperiment(key: string): UseExperimentResult {
  const { flame, ready, edge, timedOut, gaveUp } = useContext(CupedContext);

  return useMemo<UseExperimentResult>(() => {
    if (!flame) return LOADING;
    if (gaveUp.has(key)) return CONTROL;
    // flame's read records the exposure.
    if (ready) return { variant: flame.getAssignedVariantInfo(key), isLoading: false };
    if (edge) return { variant: edge[key] ?? null, isLoading: false };
    if (timedOut) {
      gaveUp.add(key);
      return CONTROL;
    }
    return LOADING;
  }, [flame, ready, edge, timedOut, gaveUp, key]);
}
