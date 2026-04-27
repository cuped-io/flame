---
"@cuped-io/flame": minor
"@cuped-io/flame-react": minor
"@cuped-io/flame-edge": minor
---

Support `'custom'` goal type for non-DOM events fired by developer code.

`GoalType` now includes `'custom'` alongside `'click' | 'submit' | 'pageview'`. Use it for events that don't have a DOM trigger — `flame.observe('vote_cast', ...)` / `useObserve()` calls from your application code. The backend matches all goals by event name; custom goals are the same code path with no auto-tracking expectation.

```tsx
import { useObserve } from '@cuped-io/flame-react';

function VoteButton({ gameId, option }: { gameId: string; option: string }) {
  const observe = useObserve();
  return (
    <button
      onClick={() => {
        castVote(option);
        observe('vote_cast', { game_id: gameId, option });
      }}
    >
      Vote
    </button>
  );
}
```

Define a Custom event goal with the same name in your cuped.io dashboard for the event to count toward an experiment.

JSDoc on `Goal`, `GoalType`, and `useObserve` also updated to clarify that `selector` is optional SDK-side metadata for auto-tracking and the backend matches by event name only.
