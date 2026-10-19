# @cuped-io/flame-edge

## 0.5.1

### Patch Changes

- Updated dependencies [d428e9e]
  - @cuped-io/flame@0.9.1

## 0.5.0

### Minor Changes

- aa165ae: flame-edge no longer counts visitors in experiments they never see. On a cookie miss it now asks cuped once for every experiment (`POST /evaluate`), which writes no assignment, instead of calling `/assign` per experiment. flame records each prehydrated variant with a `$assignment` event when it delivers it, control included, exactly as it does for variants it resolves itself. A prehydrated variant the anti-flicker timeout skipped is no longer counted or attached to events. A cookie retry after an event cap or archive also uses `/evaluate`. If that one call fails on a first visit, no cookie is set and the page resolves in the browser, as when the API is unreachable. Requires a cuped API that serves `/evaluate`.

### Patch Changes

- Updated dependencies [aa165ae]
- Updated dependencies [544ea5f]
  - @cuped-io/flame@0.9.0

## 0.4.0

### Minor Changes

- f8450f3: flame and flame-edge now read the one `resolution` field that cuped's `/assign` and `/evaluate` answers carry (`assigned`, `promoted_winner`, `held_out`, `cap_reached` or `workspace_archived`), not the three booleans it replaces (`held_out`, `cap_reached`, `workspace_archived`). flame exports the `Resolution` type. Requires a cuped API that sends `resolution`. With an older API, flame renders the original experience and flame-edge asks again later.

### Patch Changes

- Updated dependencies [f8450f3]
  - @cuped-io/flame@0.8.0

## 0.3.1

### Patch Changes

- Updated dependencies [e405615]
- Updated dependencies [ebca101]
  - @cuped-io/flame@0.7.0

## 0.3.0

### Minor Changes

- cc2a144: Ask `/assign` again for experiments that were declined because the workspace was at its event cap or archived. Previously the signed cookie kept that refusal for its whole life (30 days by default), so edge-resolved users stayed unenrolled long after an upgrade, billing reset or revive. The cookie now records declined experiments with a retry time; once it passes, the edge re-asks for just those, as the same user, and re-signs the cookie. A per-experiment API failure is retried the same way, and a failed retry backs off rather than costing every request a timeout. Held-out users are never re-asked. Older cookies remain valid.

### Patch Changes

- 711785b: Handle `/assign` answers with no variant — held out, workspace at its event cap, or workspace archived — as a normal outcome: render the original, attach no assignment to events, surface no error or warning, and don't persist the refusal to localStorage. `@cuped-io/flame-edge` leaves such experiments out of the prehydrated cookie.

  **Behavior change in `@cuped-io/flame-react`:** `<Experiment>` now renders its `fallback` only while loading. Once loaded, a user in no variant (held out, or not enrolled) gets `variants.control` — previously they kept seeing `fallback` indefinitely.

- Updated dependencies [a97adb2]
- Updated dependencies [121c2d7]
- Updated dependencies [711785b]
- Updated dependencies [4a39616]
- Updated dependencies [121c2d7]
- Updated dependencies [121c2d7]
- Updated dependencies [91a50b5]
- Updated dependencies [1ffb050]
- Updated dependencies [121c2d7]
  - @cuped-io/flame@0.6.0

## 0.2.4

### Patch Changes

- Updated dependencies [9136a16]
- Updated dependencies [1176d42]
- Updated dependencies [276041c]
- Updated dependencies [0e76ec1]
  - @cuped-io/flame@0.5.0

## 0.2.3

### Patch Changes

- Updated dependencies [7380266]
  - @cuped-io/flame@0.4.0

## 0.2.2

### Patch Changes

- Updated dependencies [0247cf8]
  - @cuped-io/flame@0.3.2

## 0.2.1

### Patch Changes

- 764a1b2: Update README + JSDoc pointers from "Settings → Goals → Custom event" to "Project → Goals → Custom event" — goals are first-class project-scoped entities now, defined on a per-project Goals page rather than under account Settings. The runtime API is unchanged; this is a docs/JSDoc fix only.
- Updated dependencies [764a1b2]
  - @cuped-io/flame@0.3.1

## 0.2.0

### Minor Changes

- dc62283: Support `'custom'` goal type for non-DOM events fired by developer code.

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

### Patch Changes

- f46b1ac: Improve READMEs for clarity and correctness, especially for the Next.js App Router setup. Adds version + license badges, direct npmjs.com links, and a Documentation section pointing to the canonical guide on cuped.io.

  Fixes two bugs in the prior zero-flash code samples that would not have compiled if copy-pasted:
  - `createCupedMiddleware` takes `secret`, not `cookieSecret`
  - `readPrehydratedForServerComponent` requires `(cookieStore, secret)` — both args are needed

  The samples now show the canonical `app/providers.tsx` + `app/layout.tsx` split (CupedProvider uses React hooks and must be wrapped in a `'use client'` component before being mounted from a server component) plus a complete `.env.local` template and the `openssl rand -base64 32` cookie-secret generation step.

- Updated dependencies [dc62283]
- Updated dependencies [f46b1ac]
  - @cuped-io/flame@0.3.0

## 0.1.1

### Patch Changes

- 44f6372: Releases now ship with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) attestations. Every published tarball is cryptographically tied to the exact GitHub Actions workflow run that produced it (visible as a "Provenance" badge on npmjs.com), and publishes are authenticated via OIDC trusted publishing rather than long-lived tokens.
- Updated dependencies [44f6372]
  - @cuped-io/flame@0.2.1
