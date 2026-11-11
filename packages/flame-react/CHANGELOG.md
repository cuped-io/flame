# @cuped-io/flame-react

## 0.5.0

### Minor Changes

- 1055f2d: A returning visitor's saved arm is on flame-react's first render, with `isLoading` false (flame#65).

  - The saved arm is there on a render that is not a hydration, from flame's stored rules file. A hydration gives what the server render gave, so the HTML matches, and the saved arm comes on the render just after it. A server-rendered page uses `prehydrated` to avoid that loading render.
  - A hydration no longer differs from the server render when flame is already ready in the browser.
  - Under React Strict Mode, `CupedProvider` starts flame once.
  - Once flame is ready, a fresh rules file that stopped the experiment can change the saved arm to control.
  - flame: an internal `earlyArms` helper in `@cuped-io/flame/rules`, for flame-react. It is not part of flame's API.

- 37baace: flame-react runs on the new core (flame#61). `useExperiment` and `<Experiment>` take the experiment's slug or id.

  - `isLoading` lasts at most the provider's new `loadingLimitMs` prop, 200 ms by default. If the limit passes before flame knows a new visitor's arm, that experiment shows control for the rest of the page view, even if the arm arrives later, and nothing is recorded. `0` means never wait.
  - With a flame-edge answer (`prehydrated`) or a flame that is already ready, the first render has the arm and `isLoading` is false.
  - A visitor is recorded in an experiment when a `useExperiment` or `<Experiment>` for it renders a real arm, not when the provider starts. Experiments no rendered component asks for are never recorded.

### Patch Changes

- 0df9f64: Every request flame makes to cuped now has a time limit, 10 seconds by default (flame#58). Set it with the new `requestTimeoutMs` option. A request that runs out counts as failed: with no stored rules file, reads answer control and `init()` completes, and an event batch is kept and sent again, as after a network error. In flame-react, `isLoading` becomes false when the limit passes, whatever `loadingLimitMs` is.
- Updated dependencies [1055f2d]
- Updated dependencies [c1a1785]
- Updated dependencies [7d85f14]
- Updated dependencies [b653fc8]
- Updated dependencies [e934bfe]
- Updated dependencies [0df9f64]
- Updated dependencies [07e8452]
  - @cuped-io/flame@0.10.0

## 0.4.4

### Patch Changes

- Updated dependencies [d428e9e]
  - @cuped-io/flame@0.9.1

## 0.4.3

### Patch Changes

- Updated dependencies [aa165ae]
- Updated dependencies [544ea5f]
  - @cuped-io/flame@0.9.0

## 0.4.2

### Patch Changes

- Updated dependencies [f8450f3]
  - @cuped-io/flame@0.8.0

## 0.4.1

### Patch Changes

- Updated dependencies [e405615]
- Updated dependencies [ebca101]
  - @cuped-io/flame@0.7.0

## 0.4.0

### Minor Changes

- 711785b: Handle `/assign` answers with no variant — held out, workspace at its event cap, or workspace archived — as a normal outcome: render the original, attach no assignment to events, surface no error or warning, and don't persist the refusal to localStorage. `@cuped-io/flame-edge` leaves such experiments out of the prehydrated cookie.

  **Behavior change in `@cuped-io/flame-react`:** `<Experiment>` now renders its `fallback` only while loading. Once loaded, a user in no variant (held out, or not enrolled) gets `variants.control` — previously they kept seeing `fallback` indefinitely.

### Patch Changes

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

## 0.3.1

### Patch Changes

- Updated dependencies [9136a16]
- Updated dependencies [1176d42]
- Updated dependencies [276041c]
- Updated dependencies [0e76ec1]
  - @cuped-io/flame@0.5.0

## 0.3.0

### Minor Changes

- 7380266: Rename observations to events and consolidate ingest on a single `/events` endpoint.

  This is a breaking change to the published wire/API contract (acceptable pre-launch — there is no back-compat alias; old `/observations` calls 404).
  - `@cuped-io/flame`: the public verb is now `flame.track()`. `observe()`, `observePageview()`, and `observeConversion()` are removed — call `track('pageview', …)` / `track('conversion', …)` instead. All sends (single + batched) POST the array envelope `{ events: [ … ] }` to `POST /{api_key}/events`; a lone event is an array of one. The `/observations` and `/observations/batch` paths are gone. Exported types renamed: `CreateObservationRequest` → `CreateEventRequest`, `CreateObservationBatchRequest` → `CreateEventBatchRequest`, `ObservationResponse` → `EventResponse`, `ObservationQueue`/`ObservationQueueConfig` → `EventQueue`/`EventQueueConfig`.
  - `@cuped-io/flame-react`: `useObserve()` is renamed to `useTrack()`.

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
