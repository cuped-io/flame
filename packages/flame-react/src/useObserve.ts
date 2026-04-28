import { useCallback, useContext } from 'react';
import { CupedContext } from './context';

/**
 * Returns a stable function that records an observation.
 *
 * The event name you pass here is what the backend uses to match
 * against goals — define a matching goal once at the project level
 * on cuped.io (Project → Goals → Custom event) and any experiment
 * in that project can attach it as primary or secondary.
 *
 * ```tsx
 * function VoteButton({ gameId, option }: Props) {
 *   const observe = useObserve();
 *   return (
 *     <button
 *       onClick={() => {
 *         castVote(option);
 *         observe('vote_cast', { game_id: gameId, option });
 *       }}
 *     >
 *       Vote
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
