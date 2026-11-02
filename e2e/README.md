# @cuped-io/e2e

Browser/e2e coverage for the flame SDK, driving the **actual example
apps** the way a customer would install them — not the unit-test jsdom
environment. Complements the packages' 260+ unit tests with a
"browser-real" run of the primary install paths.

## What it covers

| Spec                       | Example               | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/script-tag.spec.ts` | `examples/script-tag` | **flame never changes the page** (flame#63) — a MutationObserver started before flame records nothing, `history` is not wrapped and an anti-flicker snippet is never revealed, across the stock install, consent required (withheld and given), the removed `data-reapply`/`data-wait-for-hydration` attributes, a promoted winner, a Holdout member and an anti-flicker snippet; **rules file** (flame#24) — one `GET /rules` and nothing else before events, the arm the page reads is recorded before any event carries it, and an unread experiment is never recorded; a `track()` event fires; **goals by `track()`** (flame#60) — the page's `track()` for a click goal, a submit goal and a project guardrail each sends one event named after the goal, carrying the arm, and a click or submit the page does not track sends none; **promoted winners** — a read answers the winner, which is never recorded or carried. |
| `tests/next-app.spec.ts`   | `examples/next-app`   | Zero-flash SSR — the assigned variant is in the server HTML on a warm (cookie'd) visit; `useExperiment` / `<Experiment>` render the treatment; `useTrack` fires an event with the React assignment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

The SSR path renders flash-free. On the script-tag path flame changes
nothing, so there is nothing to flash.

The mock serves the rules file (`fixtures/experiments.mjs` `RULES`) to
flame and flame-edge, as ember does, and its `/events`
refuses a whole envelope over one malformed `$assignment`, or over an
`experiment_assignments` entry with no `variant_id`, with ember's `code`,
so a bad record fails the suite instead of being accepted.

## Goals are the page's `track()` calls (flame#60)

ember serves flame no goals, and flame registers no listener for them:
the example page fires each with `flame.track(goal.name)`, and the specs
assert flame sends one event by that name, carrying the arm, and none for
an untracked interaction. The selectors name elements in
`examples/script-tag/index.html` that call `track()`, so changing one
means changing that page.

## Promoted winners (flame#42, ember ADR 0039)

`fixtures/experiments.mjs` `PROMOTED` is one entry of the rules file's
`promoted` list. The promoted specs splice it into the rules file with
`page.route`; a read answers the winner, and flame records nothing for it.

## How it works

Playwright's `webServer` boots three processes for the run:

1. **Mock cuped API** (`mock-server/api.mjs`) — deterministic
   `rules`, `identity/link`, and `events` endpoints, plus `/_test/events` +
   `/_test/reset` so specs can assert on what the SDK sent. Everyone is assigned the **treatment** variant.
2. **Static host** (`mock-server/static.mjs`) — serves the repo so the
   script-tag example's relative `dist/flame.js` resolves, and rewrites
   its placeholder `data-dsn` to the live mock DSN.
3. **next-app** — built and started against the mock DSN, so the edge
   middleware resolves real assignments server-side.

Fixtures shared by the mock server and the specs live in
`fixtures/experiments.mjs`.

## Running

From the repo root (builds the packages first, so `dist/flame.js` and
the next-app's workspace deps exist):

```bash
pnpm test:e2e:install   # one-time: fetch the Chromium browser
pnpm test:e2e
```

Iterating on just the script-tag path (skips the slow next-app build):

```bash
cd e2e
E2E_SKIP_NEXT=1 pnpm exec playwright test tests/script-tag.spec.ts
```
