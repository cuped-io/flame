# @cuped-io/flame

## 0.7.0

### Minor Changes

- e405615: Visitors are counted in a variant only once they are shown it. flame now asks cuped once for every experiment (`POST /evaluate`) and records a visitor's variant with a `$assignment` event at the moment it applies it, control included. A visitor whose page the anti-flicker timeout revealed before flame was ready sees the original and is no longer counted in a variant they never saw, and their events carry no experiment. The record goes out before the pageview and any event tagged with that variant, once per visitor per experiment. `init()` now resolves after the variants are applied or skipped, which on a page waiting for React to hydrate can be up to 5 seconds later. The first pageview waits for that decision too; a visitor who leaves before it still sends the pageview and any events buffered before `init()`, with no experiment, since they never saw the variant. Events fired during the wait (clicks, form submits, `track()` calls) also carry no experiment: they happened before the visitor saw the variant, so they are not counted in its results. Requires a cuped API that serves `/evaluate`. Pages using `@cuped-io/flame-edge` are unchanged.

### Patch Changes

- ebca101: Withdrawing consent, or calling `reset()`, while flame is still fetching experiments now stops that start. Before, the answer arriving afterwards still registered the visitor's arms, applied promoted winners, watched the page for re-created targets and logged "Failed to initialize"; after a `reset()` it also applied the variant and sent its `$assignment` record.

## 0.6.0

### Minor Changes

- a97adb2: Consent support. With `requireConsent: true` (script tag: `data-consent="required"`), flame does nothing until `flame.consent(true)`: no ID, no storage, no network, and the original page shows. Accepting assigns and applies the variant on the current page and starts tracking. `consentApply: 'next-page'` (`data-consent-apply="next-page"`) waits for the next page load instead, which excludes single-page apps and single landing pages. `flame.consent(false)` sends nothing more: queued events are dropped, not sent, and the stored ID, assignments and retry queue are deleted. The choice is remembered on later pages. A browser Global Privacy Control or Do Not Track signal keeps flame off, and `consent(true)` then returns `'blocked_by_signal'` and logs why. `flame.consentState()` reports where things stand. Experiments measure consenting visitors only.
- 121c2d7: E-commerce auto-detection (add to cart, checkout and similar clicks) is now opt-in. Turn it on with `autoEcommerce: true` in `init()`, or with `data-ecommerce="true"` on the script tag. It was on for every site, its selectors could match unrelated buttons, and every match is a billable event.
- 4a39616: On server-rendered React sites, flame now waits for React to hydrate an element before applying a variant to it. Applying earlier made React throw error #418 (hydration mismatch) in your app and discard the variant. This is automatic on Next.js, Remix, React Router 7 and Gatsby. For other React server-rendered pages, add `data-wait-for-hydration="true"` to the script tag (or `waitForHydration: true` in `init()`); `"false"` turns it off. If hydration has not happened within 5 seconds, flame applies anyway.
- 91a50b5: Serve promoted winners. `/experiments/active` now lists concluded experiments whose winner was promoted under `promoted`, and the SDK applies each winner's changes through the same anti-flicker path as running experiments. It asks `/assign` for each one on every page load, so held-out visitors keep the original experience, and it ignores any stored assignment for that experiment without overwriting it, so a reverted promotion puts visitors back in their original variant. Promoted experiments attach nothing to events and register no goals. Previously a promoted experiment dropped out of `experiments` and every visitor reverted to the original. Edge-prehydrated (`@cuped-io/flame-edge`) pages don't serve promoted winners yet.
- 1ffb050: Variants now survive single-page-app navigation and framework re-renders. flame keeps watching the page after the first apply. When an element a variant targets is re-created (for example, after navigating away and back within the app), flame applies the variant to it again. Your site's own later changes to an element flame already changed are left alone. Redirects are never re-applied. If the page keeps re-creating an element every time flame changes it, flame stops after 10 times in a second and logs why, so the two never fight. Turn it off with `data-reapply="false"` on the script tag, or `reapplyOnChange: false` in `init()`.

### Patch Changes

- 711785b: Handle `/assign` answers with no variant — held out, workspace at its event cap, or workspace archived — as a normal outcome: render the original, attach no assignment to events, surface no error or warning, and don't persist the refusal to localStorage. `@cuped-io/flame-edge` leaves such experiments out of the prehydrated cookie.

  **Behavior change in `@cuped-io/flame-react`:** `<Experiment>` now renders its `fallback` only while loading. Once loaded, a user in no variant (held out, or not enrolled) gets `variants.control` — previously they kept seeing `fallback` indefinitely.

- 121c2d7: `identify()` and `clearIdentity()` now switch the user on the existing tracker instead of replacing it. Previously, after `identify()` the old click and submit listeners kept firing under the device ID and the new tracker never auto-tracked, so one visitor could count as two. After `clearIdentity()`, events kept the logged-in user's ID.
- 121c2d7: One failing experiment no longer stops the others. A failed assignment request or an invalid CSS selector now affects only that experiment: the rest still apply, the pageview is still tracked, and an anti-flicker page is always revealed instead of waiting for its timeout.
- 121c2d7: A redirect variant no longer redirects again when the visitor is already on its destination page. Previously it looped. On the destination page, the variant's other changes now apply.

## 0.5.0

### Minor Changes

- 9136a16: Anti-flicker for the script-tag SDK (#16). When an anti-flicker hide snippet is present on the page, flame now reveals the page the moment variants are applied — coordinating through `window.__cupedAntiflicker` — so the control never flashes before the treatment. The reveal is idempotent and race-safe with the snippet's timeout fallback: if the timeout already revealed the original (slow or failed API), flame skips a late variant apply so there's no late flash, and those visitors stay on control. Fully backward-compatible: a no-op when no anti-flicker snippet is present.
- 0e76ec1: Publish a versioned, integrity-pinnable CDN artifact.

  The script-tag build now emits an immutable `flame@X.Y.Z.js` alongside the floating `flame.js`, plus a `flame.sri.json` manifest carrying the Subresource Integrity (sha384) hash for each path. Embedders can pin to the versioned path with `integrity` + `crossorigin="anonymous"` so a bad deploy can't silently reach every site, and can roll back by pointing at the previous version. The floating `flame.js` remains as an opt-in "latest" (unpinnable by design). See the install snippet in the README.

### Patch Changes

- 1176d42: Parallelize experiment assignment on init (#17). The script-tag SDK previously requested assignments in a serial loop — N experiments meant N sequential `/assign` round-trips, so a slow API compounded per experiment (and delayed variant application). Assignments now resolve concurrently in a single batch, with registration order preserved. No API change; a slow API now costs one round-trip, not N.
- 276041c: Buffer events tracked before init (#20). `track()` / `useTrack()` called before the SDK finished initializing previously dropped the event silently — contradicting `useTrack`'s documented behavior. Pre-init events are now buffered and delivered once init completes, carrying the active experiment assignments. Also removed an unused internal URL-pattern matcher (dead code — the backend is the source of truth for pageview-goal URL matching).

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
