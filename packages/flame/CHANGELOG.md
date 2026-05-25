# @cuped-io/flame

## 0.4.0

### Minor Changes

- 7380266: Rename observations to events and consolidate ingest on a single `/events` endpoint.

  This is a breaking change to the published wire/API contract (acceptable pre-launch — there is no back-compat alias; old `/observations` calls 404).
  - `@cuped-io/flame`: the public verb is now `flame.track()`. `observe()`, `observePageview()`, and `observeConversion()` are removed — call `track('pageview', …)` / `track('conversion', …)` instead. All sends (single + batched) POST the array envelope `{ events: [ … ] }` to `POST /{api_key}/events`; a lone event is an array of one. The `/observations` and `/observations/batch` paths are gone. Exported types renamed: `CreateObservationRequest` → `CreateEventRequest`, `CreateObservationBatchRequest` → `CreateEventBatchRequest`, `ObservationResponse` → `EventResponse`, `ObservationQueue`/`ObservationQueueConfig` → `EventQueue`/`EventQueueConfig`.
  - `@cuped-io/flame-react`: `useObserve()` is renamed to `useTrack()`.

## 0.3.2

### Patch Changes

- 0247cf8: A **Form Submit** goal with no CSS selector now fires on any form
  submission on the page, instead of silently never firing. The
  auto-tracker previously skipped every click/submit goal whose selector
  was empty, so a no-code "track any form submit as a conversion" goal
  collected no data and gave no error. Submit goals with a selector are
  unchanged (they still fire only when the submitted form matches), and
  click goals still require a selector — an empty-selector click goal has
  no target to bind to and remains observable only via `flame.observe()`.

## 0.3.1

### Patch Changes

- 764a1b2: Update README + JSDoc pointers from "Settings → Goals → Custom event" to "Project → Goals → Custom event" — goals are first-class project-scoped entities now, defined on a per-project Goals page rather than under account Settings. The runtime API is unchanged; this is a docs/JSDoc fix only.

## 0.3.0

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

## 0.2.1

### Patch Changes

- 44f6372: Releases now ship with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) attestations. Every published tarball is cryptographically tied to the exact GitHub Actions workflow run that produced it (visible as a "Provenance" badge on npmjs.com), and publishes are authenticated via OIDC trusted publishing rather than long-lived tokens.
