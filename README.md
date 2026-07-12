# flame

[![@cuped-io/flame on npm](https://img.shields.io/npm/v/@cuped-io/flame?label=%40cuped-io%2Fflame)](https://www.npmjs.com/package/@cuped-io/flame)
[![@cuped-io/flame-react on npm](https://img.shields.io/npm/v/@cuped-io/flame-react?label=flame-react)](https://www.npmjs.com/package/@cuped-io/flame-react)
[![@cuped-io/flame-edge on npm](https://img.shields.io/npm/v/@cuped-io/flame-edge?label=flame-edge)](https://www.npmjs.com/package/@cuped-io/flame-edge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Client-side SDKs for [cuped.io](https://cuped.io) — A/B testing with CUPED variance reduction.

This repo is a pnpm workspace with three packages:

| Package | npm | Source | Role |
|---|---|---|---|
| `@cuped-io/flame` | [npmjs.com](https://www.npmjs.com/package/@cuped-io/flame) | [./packages/flame](./packages/flame) | Core SDK. IIFE for `<script>` tag use; ESM/CJS for npm consumers. |
| `@cuped-io/flame-react` | [npmjs.com](https://www.npmjs.com/package/@cuped-io/flame-react) | [./packages/flame-react](./packages/flame-react) | React bindings: `<CupedProvider>`, `useExperiment`, `<Experiment>`, `useTrack`. |
| `@cuped-io/flame-edge` | [npmjs.com](https://www.npmjs.com/package/@cuped-io/flame-edge) | [./packages/flame-edge](./packages/flame-edge) | Edge resolver + signed cookie utilities for zero-flash SSR. Web Crypto only. |

## What it does

1. Fetches active experiments for a project
2. Assigns visitors to variants
3. Applies variant changes to the DOM (8 change types: `text`, `html`, `attribute`, `class`, `style`, `css`, `visibility`, `redirect`)
4. Auto-detects e-commerce events (add to cart, checkout, etc.)
5. Tracks events with experiment assignments for server-side goal matching

## Quick start

You'll need a DSN. Sign up at [cuped.io](https://cuped.io), create a project, and copy the DSN from **Settings → Install snippet** (it looks like `https://YOUR_KEY@api.cuped.io`).

### Option 1: Script tag (no-code DOM mutations)

Drop this in your `<head>` and define variants in the dashboard. Pin to a
version and guard it with [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity)
so a bad deploy can't reach your site (`crossorigin` is required for SRI to
work on the cross-origin script):

```html
<script
  src="https://cdn.cuped.io/flame@0.4.0.js"
  integrity="sha384-zV6If+2sDPRrWSbiaFZ2P5A4fBe6uIqixLvv3rAeMZrqbztP4P/8s0fRfAQxr2TD"
  crossorigin="anonymous"
  data-dsn="https://YOUR_KEY@api.cuped.io"
></script>
```

The dashboard's install snippet is always pinned to the current release with
its SRI hash filled in, and that hash is also published at
[`cdn.cuped.io/flame.sri.json`](https://cdn.cuped.io/flame.sri.json).

> **Prefer auto-updates over pinning?** `https://cdn.cuped.io/flame.js` is a
> floating "latest" that always serves the newest release. It can't be pinned
> with SRI (the bytes change on every deploy), so you trade integrity
> verification and rollback safety for automatic upgrades.

### Option 2: React (CSR)

```bash
pnpm add @cuped-io/flame @cuped-io/flame-react
```

```tsx
import { CupedProvider, useExperiment } from '@cuped-io/flame-react';

function App() {
  return (
    <CupedProvider dsn="https://YOUR_KEY@api.cuped.io">
      <Hero />
    </CupedProvider>
  );
}

function Hero() {
  const { variant } = useExperiment('hero-cta');
  return <button>{variant?.name === 'treatment' ? 'Buy now' : 'Get started'}</button>;
}
```

### Option 3: Next.js App Router with zero-flash SSR

The recommended setup for Next.js. Variants are resolved at the edge before the first byte renders, so server HTML matches the assigned variant from request #1.

```bash
pnpm add @cuped-io/flame @cuped-io/flame-react @cuped-io/flame-edge
```

`.env.local`:

```
CUPED_DSN=https://YOUR_KEY@api.cuped.io
NEXT_PUBLIC_CUPED_DSN=https://YOUR_KEY@api.cuped.io
CUPED_COOKIE_SECRET=<generate with: openssl rand -base64 32>
```

`middleware.ts`:

```ts
import { createCupedMiddleware } from '@cuped-io/flame-edge/next';

export default createCupedMiddleware({
  dsn: process.env.CUPED_DSN!,
  secret: process.env.CUPED_COOKIE_SECRET!,
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|api/|favicon.ico).*)'],
};
```

`app/providers.tsx`:

```tsx
'use client';
import { CupedProvider } from '@cuped-io/flame-react';
import type { PrehydratedState } from '@cuped-io/flame';

export function Providers({
  children,
  prehydrated,
}: {
  children: React.ReactNode;
  prehydrated?: PrehydratedState;
}) {
  return (
    <CupedProvider
      dsn={process.env.NEXT_PUBLIC_CUPED_DSN!}
      prehydrated={prehydrated}
    >
      {children}
    </CupedProvider>
  );
}
```

`app/layout.tsx`:

```tsx
import { cookies } from 'next/headers';
import { readPrehydratedForServerComponent } from '@cuped-io/flame-edge/next';
import { Providers } from './providers';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const prehydrated = await readPrehydratedForServerComponent(
    await cookies(),
    process.env.CUPED_COOKIE_SECRET!,
  );
  return (
    <html>
      <body>
        <Providers prehydrated={prehydrated ?? undefined}>{children}</Providers>
      </body>
    </html>
  );
}
```

That's it — `useExperiment` and `<Experiment>` work the same way as Option 2.

## Examples

- [`examples/script-tag`](./examples/script-tag) — Static HTML page exercising all 8 change types.
- [`examples/next-app`](./examples/next-app) — Next.js App Router app with edge middleware + signed prehydrated cookie. Includes verification steps.

## Documentation

- [React + Next.js guide](https://cuped.io/docs/react-sdk) — full reference including all hooks, the `<Experiment>` component, and zero-flash SSR
- [Script-tag SDK](https://cuped.io/docs/sdk)
- [REST API](https://cuped.io/docs/api)
- [Methodology: CUPED & Bayesian](https://cuped.io/docs/cuped)

## Development

```bash
pnpm install
pnpm test         # unit tests, all packages
pnpm typecheck
pnpm lint
pnpm build        # IIFE + ESM/CJS across packages

pnpm test:e2e:install   # one-time: fetch the Chromium browser
pnpm test:e2e           # Playwright browser tests against both examples
```

The Playwright suite ([`e2e/`](./e2e)) drives the real script-tag and
Next.js examples in a browser against a mock cuped API — assignment
application, zero-flash SSR, and event delivery. See [e2e/README.md](./e2e/README.md).

Releases are managed by [changesets](https://github.com/changesets/changesets) and published to npm via OIDC trusted publishing with [provenance attestations](https://docs.npmjs.com/generating-provenance-statements).

## License

MIT — see [LICENSE](./LICENSE).
