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
flame and `/evaluate` to flame-edge, as ember does, and its `/events`
refuses a whole envelope over one malformed `$assignment`, as ember does,
so a bad record fails the suite instead of being accepted.

## The goal contract (cuped-io/ember#171)

`fixtures/experiments-active-goals.contract.json` is a **golden
instance** of the `goals` array cuped's `/experiments/active` serves. It
has a byte-identical twin in the ember repo
(`crates/ember-core/tests/contracts/experiments_active_goals.json`),
where a test asserts the endpoint emits exactly this for a known goal
configuration. Here the mock API serves it verbatim as the script-tag
experiment's goals. flame registers no listener for them (flame#60): the
example page fires each with `flame.track(goal.name)`, and the specs
assert flame sends one event by that name, and none for an untracked
interaction.

Two halves of one claim:

- ember: _given this goal configuration, I emit this payload._
- flame: _given this payload, the page's `track('cart_add_clicked')` sends one
  event by that name, carrying the arm, and a bare click sends none._

The pairing exists because ember#171 sat undetected for a whole
migration with both suites green. Goals moved to project-scoped tables
server-side; the SDK payload kept serializing a legacy column and
shipped `"goals": null`; every dashboard-created click/submit goal
recorded zero conversions, silently, because the backend matches
conversions on the event _name_ the auto-tracker then fired. ember's tests
asserted the endpoint returned experiments. This suite asserted
auto-tracking worked — against a fixture that carried `goals: []`.
Nothing pinned the shape they exchanged, so nothing failed.

Changing the payload shape means changing both copies in the same
change: a unilateral edit fails that side's own suite. (Nothing
mechanically enforces the two files are identical — that would need a
shared package or cross-repo CI. What's guaranteed is that neither side
can move alone.) The selectors name elements in
`examples/script-tag/index.html` that call `track()`, so changing one
means changing that page.

## The promoted contract (cuped-io/ember#300, flame#42)

`fixtures/experiments-active-promoted.contract.json` is the same kind of
golden instance, for one entry of the `promoted` list
`/experiments/active` serves alongside `experiments`. Its twin is
ember's `crates/ember-core/tests/contracts/experiments_active_promoted.json`.
The promoted specs splice it into the rules file with `page.route`;
a read answers the winner, and flame records nothing for it. The
contract's winner still carries a `changes` payload, which flame
ignores: the page is unchanged.

## How it works

Playwright's `webServer` boots three processes for the run:

1. **Mock cuped API** (`mock-server/api.mjs`) — deterministic
   `rules`, `experiments/active`, `evaluate`, `assign`,
   `identity/link`, and `events` endpoints, plus `/_test/events` +
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
