# cuped.io zero-flash SSR — Next.js example

Tiny Next.js App Router app demonstrating the v0.3 zero-flash SSR
flow:

```
edge middleware → reads/writes signed cookie → server component
reads cookie → CupedProvider gets prehydrated state → useExperiment
returns the right variant on first server render → client hydrates
without re-fetching → no flash, no hydration mismatch
```

This app is also our manual integration test for the SSR path. See
**Verification** below.

## Setup

You need a running cuped project (a DSN from your cuped.io dashboard) with at
least one experiment in `running` status that has 2+ variants.

```bash
# From the flame repo root
pnpm install

# Configure env
cd examples/next-app
cp .env.example .env.local
# Edit .env.local:
#   CUPED_DSN                       — server-side DSN
#   NEXT_PUBLIC_CUPED_DSN           — same DSN, exposed to client
#   CUPED_COOKIE_SECRET             — `openssl rand -base64 32`
#   NEXT_PUBLIC_CUPED_EXPERIMENT_ID — id of a running experiment

# Run
pnpm dev
# (or from the repo root: pnpm example:next)
```

App boots on <http://localhost:3210>.

## How it's wired

| File | Role |
|---|---|
| `middleware.ts` | Edge middleware — `createCupedMiddleware` from `@cuped-io/flame-edge/next`. Reads cookie or cold-resolves; writes Set-Cookie. |
| `app/layout.tsx` | Server component — `readPrehydratedForServerComponent` reads the same cookie via `cookies()` and passes the decoded payload to `<Providers>`. |
| `app/providers.tsx` | Client component — wraps `<CupedProvider>` with the prehydrated prop. Lives in its own file because Server Components can't use context. |
| `app/page.tsx` | Demo page — exercises `useExperiment`, `<Experiment>`, and `useObserve`. |

The variant configured in your dashboard's `name` field needs to
match a key in the `<Experiment variants={...}>` map — the example
uses `control` / `treatment`. Adjust to whatever names your variants
actually have.

## Verification (manual)

These are the steps to confirm zero-flash SSR is working
end-to-end. Run them in a private/incognito window so you start
without a cookie.

### 1. First visit — cold resolution

1. Open <http://localhost:3210> in DevTools' Network tab.
2. Observe the request to `/` — the response HTML should already
   contain the assigned variant's text. **View Source** confirms this
   visually: search for the variant name (`control` or `treatment`)
   in the raw HTML returned by the server.
3. The middleware will have made two network calls **server-side**
   (you won't see them in the browser tab):
   - `GET <CUPED_DSN host>/{key}/experiments/active`
   - `POST <CUPED_DSN host>/{key}/experiments/{id}/assign`
4. Application tab → Cookies → `localhost:3210`. There's a
   `cuped_state` cookie with a long base64url-encoded value.

### 2. No flash — visual

The variant pill (control = blue, treatment = green) should appear in
its final color from the moment the page paints. There should be no
flicker from gray→colored or from blue→green.

If you see a flicker:
- Open the React DevTools "Highlight updates when components render"
  setting. The variant component should NOT re-render on hydration.
- Check `app/layout.tsx` — `prehydrated` should not be `null` on the
  second request. If it is, the middleware never set the cookie
  (likely an env var issue).

### 3. Repeat visit — cache

1. Reload the page.
2. Network tab — the middleware should NOT fire fresh
   `/experiments/active` or `/assign` calls. The cookie short-circuits
   cold resolution.
3. Page renders correctly, same variant.

### 4. Tampered cookie — re-resolution

1. In DevTools, edit the `cuped_state` cookie value (change one char).
2. Reload.
3. Middleware sees the bad signature, treats as missing, re-resolves.
4. Network tab shows fresh API calls server-side; new cookie set.
5. Page renders correctly.

### 5. Expired cookie

Hard to test directly without waiting 30 days, but you can inspect
the signed payload manually. Decode the part before the `.`:

```bash
echo '<base64-from-before-dot>' | base64 -d | jq
# {"v":1,"iat":...,"exp":...,"state":{...}}
```

`exp` is unix-seconds-since-epoch. After that timestamp, the cookie
is rejected.

### 6. Network failure path

Stop the cuped API (or set `CUPED_DSN` to an unreachable host).
Reload. Middleware should silently fail; the page should still load
with `prehydrated=null` and the React provider falls back to its
v0.1 client-init path. Variant is briefly the control (loading
state), then re-renders to the assigned variant if any. **The page
shouldn't break, just degrade.**

## What this doesn't cover

- The script-tag flame path (no React, no SSR). For that, see
  [`examples/script-tag/`](../script-tag).

## Other frameworks

This example uses the Next.js helpers (`@cuped-io/flame-edge/next`).
For Remix, TanStack Start, SvelteKit, Cloudflare Workers, or any
Web-standard runtime, use `@cuped-io/flame-edge`'s `resolveAssignments`
and `readPrehydratedFromCookieHeader` directly. See the React SDK
docs in your cuped.io dashboard for snippets.
