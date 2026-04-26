import { useContext, useMemo } from 'react';
import { CupedContext } from './context';
import type { UseExperimentResult } from './types';

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
 * `variant` is the full {@link Variant} object (id, name, is_control,
 * changes), or `null` if the SDK is still initializing or the user
 * isn't assigned to this experiment. `isLoading` is true until the
 * provider's underlying `flame.init()` resolves — except when the
 * provider was given a `prehydrated` payload covering this
 * experiment, in which case the variant is available synchronously
 * (including during server render).
 *
 * Must be rendered inside a {@link CupedProvider}.
 */
export function useExperiment(experimentId: string): UseExperimentResult {
  const { flame, initialized, assignments, initTick } = useContext(CupedContext);

  return useMemo<UseExperimentResult>(() => {
    // Prehydrated map is synchronous; if it has the answer, return
    // it even pre-init. Server render and the very first client
    // render both go through this branch when prehydrated covers the
    // experiment.
    const prehydratedVariant = assignments[experimentId];
    if (prehydratedVariant) {
      return { variant: prehydratedVariant, isLoading: false };
    }
    // No prehydrated entry — fall back to flame's runtime state.
    if (!flame || !initialized) {
      return { variant: null, isLoading: true };
    }
    return { variant: flame.getAssignedVariantInfo(experimentId), isLoading: false };
  }, [flame, initialized, assignments, initTick, experimentId]);
}
