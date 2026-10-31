# cuped.io flame — script-tag test page

Static HTML page that loads flame from a script tag. flame never changes
the page: it picks the visitor's variants from your project's rules file,
and your code reads one with `flame.getVariant('experiment-slug')` once
`flame.ready` resolves. The page's buttons fire goals with
`flame.track()`.

This is the testing complement to `examples/next-app/` (which covers
the React SDK + zero-flash SSR path). Use this one for:

- Pre-deployment smoke tests for the script-tag flow
- Checking reads and events against a project without needing a
  customer's site

## Setup

```bash
# 1. Build flame so dist/flame.js exists
pnpm --filter @cuped-io/flame build

# 2. Edit examples/script-tag/index.html — replace the data-dsn value
#    with your project DSN.

# 3. Serve the repo root (the script tag uses a relative path)
npx http-server -p 8080
```

Open <http://localhost:8080/examples/script-tag/>.

## What to verify

1. **flame loads.** Console shows `[Flame] Initialized` debug logs.
   `window.flame` is defined, and `await flame.ready` resolves.
2. **The rules file is fetched.** Network tab shows one
   `GET /:dsn/rules`.
3. **A read answers and records.** In the console,
   `flame.getVariant('your-experiment-slug')` returns a variant id. The
   first read sends a `$assignment` event in the next
   `POST /:dsn/events`.
4. **Identity is persistent.** "Show identity" button dumps the
   device id; reload → same id.
5. **Events fire.** "Fire event" button → Network shows
   `POST /:dsn/events` with the `{ events: [...] }` envelope (a single
   event is an array of one; batched sends carry several). After a
   read, each event carries the arm.

## Limitations

- This page doesn't cover the React SDK or SSR — see
  `examples/next-app/`.
- Automated coverage lives in `e2e/tests/script-tag.spec.ts`.
