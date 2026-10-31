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
| `middleware.ts` | Edge middleware — `createCupedMiddleware` from `@cuped-io/flame-edge/next`. Picks arms from its rules copy; writes Set-Cookie when they change. |
| `app/layout.tsx` | Server component — `readPrehydratedForServerComponent` reads the same cookie via `cookies()` and passes the decoded payload to `<Providers>`. |
| `app/providers.tsx` | Client component — wraps `<CupedProvider>` with the prehydrated prop. Lives in its own file because Server Components can't use context. |
| `app/page.tsx` | Demo page — exercises `useExperiment`, `<Experiment>`, and `useTrack`. |

The variant configured in your dashboard's `name` field needs to
match a key in the `<Experiment variants={...}>` map — the example
uses `control` / `treatment`. Adjust to whatever names your variants
actually have.

## Verification (manual)

These are the steps to confirm zero-flash SSR is working
end-to-end. Run them in a private/incognito window so you start
without a cookie.

### 1. First visit — the edge picks

1. Open <http://localhost:3210> in DevTools' Network tab.
2. Right after the server starts, the first request has no rules copy
   yet: the middleware answers at once with no arms, the browser picks,
   and no `cuped_state` cookie is set. Meanwhile the server fetches
   `GET <CUPED_DSN host>/{key}/rules` in the background (you won't see
   it in the browser tab).
3. Open the page in a fresh private window. The response HTML should
   already contain the assigned variant's text. **View Source**
   confirms this visually: search for the variant name (`control` or
   `treatment`) in the raw HTML returned by the server.
4. Application tab → Cookies → `localhost:3210`. There's a short
   `cuped_state` cookie (a few hundred bytes).

### 2. No flash — visual

The variant pill (control = blue, treatment = green) should appear in
its final color from the moment the page paints. There should be no
flicker from gray→colored or from blue→green.

If you see a flicker:
- Open the React DevTools "Highlight updates when components render"
  setting. The variant component should NOT re-render on hydration.
- Check `app/layout.tsx` — `prehydrated` should not be `null` once the
  server has its rules copy. If it is, check the env vars: the layout
  needs `CUPED_DSN` as well as the secret.

### 3. Repeat visit — same arms

1. Reload the page.
2. The request never waits on the cuped API: the server refreshes its
   rules copy in the background about once a minute.
3. Page renders correctly, same variant. Start a new experiment in the
   dashboard: within about a minute, a reload gives it an arm too. Stop
   one: it drops out.

### 4. Tampered cookie — new visitor

1. In DevTools, edit the `cuped_state` cookie value (change one char).
2. Reload.
3. Middleware sees the bad signature and treats the request as a new
   visitor; new cookie set.
4. Page renders correctly.

### 5. Expired cookie

Hard to test directly without waiting 30 days, but you can inspect
the signed payload manually. Decode the part before the `.`:

```bash
echo '<base64-from-before-dot>' | base64 -d | jq
# {"v":2,"iat":...,"exp":...,"vid":"...","since":...,"arms":["..."]}
```

`exp` is unix-seconds-since-epoch. After that timestamp, the cookie
is rejected.

### 6. Network failure path

Stop the cuped API (or set `CUPED_DSN` to an unreachable host) and
restart the server, so it has no rules copy. Reload. The page should
load at once with `prehydrated=null`, and the browser picks. **The
page shouldn't break, just degrade.** With the API stopped but the
server already holding a copy, the edge keeps picking from that copy.

## What this doesn't cover

- The script-tag flame path (no React, no SSR). For that, see
  [`examples/script-tag/`](../script-tag).

## Other frameworks

This example uses the Next.js helpers (`@cuped-io/flame-edge/next`).
For Remix, TanStack Start, SvelteKit, Cloudflare Workers, or any
Web-standard runtime, use `@cuped-io/flame-edge`'s `resolveAssignments`
and `readPrehydratedFromCookieHeader` directly. See the React SDK
docs in your cuped.io dashboard for snippets.
