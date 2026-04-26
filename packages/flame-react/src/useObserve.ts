import { useCallback, useContext } from 'react';
import { CupedContext } from './context';

/**
 * Returns a stable function that records an observation.
 *
 * ```tsx
 * function SignupForm() {
 *   const observe = useObserve();
 *   return (
 *     <button onClick={() => observe('signup_completed', { plan: 'pro' })}>
 *       Sign up
 *     </button>
 *   );
 * }
 * ```
 *
 * The returned function is referentially stable across renders, so
 * passing it as a prop or putting it in an effect's dep array won't
 * cause spurious re-runs.
 *
 * If the SDK isn't initialized yet, the call is buffered into
 * flame's observation queue once init completes.
 */
export function useObserve(): (eventType: string, metadata?: Record<string, unknown>) => void {
  const { flame } = useContext(CupedContext);

  return useCallback(
    (eventType: string, metadata?: Record<string, unknown>) => {
      if (!flame) {
        console.warn('[CupedProvider] useObserve called outside provider; observation dropped');
        return;
      }
      flame.observe(eventType, metadata);
    },
    [flame]
  );
}
