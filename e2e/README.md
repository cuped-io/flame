# @cuped-io/e2e

Browser/e2e coverage for the flame SDK, driving the **actual example
apps** the way a customer would install them — not the unit-test jsdom
environment. Complements the packages' 260+ unit tests with a
"browser-real" run of the primary install paths.

## What it covers

| Spec                       | Example               | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/script-tag.spec.ts` | `examples/script-tag` | Assignment applies across every non-redirect change type (`text`, `html`, `attribute`, `class`, `style`, `css`, `visibility`); a `pageview` event and a `track()` event fire with the assignment attached; **goal auto-tracking** — a click goal, a submit goal and a project guardrail each fire an event named after the goal, and nothing fires for an unmatched click; **promoted winners** — the promoted contract's winner applies, a held-out visitor keeps the original, and no event carries the promoted experiment; **record on delivery** (flame#46) — one `/evaluate`, no `/assign`, and each delivered arm's `$assignment` record arrives before the pageview, including when flame answers while the page is still loading (`fixtures/pages/async-head.html`); **anti-flicker** — the page stays hidden until variants apply, and a stalled API reveals the original after the timeout. |
| `tests/next-app.spec.ts`   | `examples/next-app`   | Zero-flash SSR — the assigned variant is in the server HTML on a warm (cookie'd) visit; `useExperiment` / `<Experiment>` render the treatment; `useTrack` fires an event with the React assignment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

The SSR path renders flash-free, and the script-tag path is flash-free
behind the anti-flicker snippet (flame#16); both are asserted for real.

The mock serves `/evaluate` as ember does (ADR 0041), and its `/events`
refuses a whole envelope over one malformed `$assignment`, as ember does,
so a bad record fails the suite instead of being accepted.

## The goal contract (cuped-io/ember#171)

`fixtures/experiments-active-goals.contract.json` is a **golden
instance** of the `goals` array cuped's `/experiments/active` serves. It
has a byte-identical twin in the ember repo
(`crates/ember-core/tests/contracts/experiments_active_goals.json`),
where a test asserts the endpoint emits exactly this for a known goal
configuration. Here the mock API serves it verbatim as the script-tag
experiment's goals, and the specs drive real Chromium interactions
against the selectors it names.

Two halves of one claim:

- ember: _given this goal configuration, I emit this payload._
- flame: _given this payload, a click on `.add-to-cart-cta` fires an
  event named `cart_add_clicked`._

The pairing exists because ember#171 sat undetected for a whole
migration with both suites green. Goals moved to project-scoped tables
server-side; the SDK payload kept serializing a legacy column and
shipped `"goals": null`; every dashboard-created click/submit goal
recorded zero conversions, silently, because the backend matches
conversions on the event _name_ the auto-tracker fires. ember's tests
asserted the endpoint returned experiments. This suite asserted
auto-tracking worked — against a fixture that carried `goals: []`.
Nothing pinned the shape they exchanged, so nothing failed.

Changing the payload shape means changing both copies in the same
change: a unilateral edit fails that side's own suite. (Nothing
mechanically enforces the two files are identical — that would need a
shared package or cross-repo CI. What's guaranteed is that neither side
can move alone.) The selectors are load-bearing too: they match elements
in `examples/script-tag/index.html`, so changing one means changing that
page.

## The promoted contract (cuped-io/ember#300, flame#42)

`fixtures/experiments-active-promoted.contract.json` is the same kind of
golden instance, for one entry of the `promoted` list
`/experiments/active` serves alongside `experiments`. Its twin is
ember's `crates/ember-core/tests/contracts/experiments_active_promoted.json`.
The mock's `/evaluate` answers it with the winner, and flame records
nothing for it. It is not in the default response (its winner targets
`#target-text`, as the script-tag experiment's treatment does), so the
promoted specs splice it in with `page.route`.

## How it works

Playwright's `webServer` boots three processes for the run:

1. **Mock cuped API** (`mock-server/api.mjs`) — deterministic
   `experiments/active`, `assign`, `identity/link`, and `events`
   endpoints, plus `/_test/events` + `/_test/reset` so specs can assert
   on what the SDK sent. Everyone is assigned the **treatment** variant.
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
