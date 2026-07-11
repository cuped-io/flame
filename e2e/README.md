# @cuped-io/e2e

Browser/e2e coverage for the flame SDK, driving the **actual example
apps** the way a customer would install them — not the unit-test jsdom
environment. Complements the packages' 260+ unit tests with a
"browser-real" run of the primary install paths.

## What it covers

| Spec | Example | Asserts |
|---|---|---|
| `tests/script-tag.spec.ts` | `examples/script-tag` | Assignment applies across every non-redirect change type (`text`, `html`, `attribute`, `class`, `style`, `css`, `visibility`); a `pageview` event and a `track()` event fire with the assignment attached. |
| `tests/next-app.spec.ts` | `examples/next-app` | Zero-flash SSR — the assigned variant is in the server HTML on a warm (cookie'd) visit; `useExperiment` / `<Experiment>` render the treatment; `useTrack` fires an event with the React assignment. |

The script-tag "no flash" case is a `test.fixme` — the script-tag SDK
applies variants only after the experiments/assign roundtrip, so it
flashes today. Un-fixme it once anti-flicker lands (issue #21). The
SSR path already renders flash-free and is asserted for real.

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
