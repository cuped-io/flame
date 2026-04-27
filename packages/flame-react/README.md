# @cuped-io/flame-react

[![npm](https://img.shields.io/npm/v/@cuped-io/flame-react)](https://www.npmjs.com/package/@cuped-io/flame-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cuped-io/flame/blob/main/LICENSE)

React bindings for the [cuped.io](https://cuped.io) A/B testing SDK.

Provides `<CupedProvider>`, `useExperiment`, `<Experiment>`, and `useObserve` so you can branch React components on variant assignment without touching the DOM directly.

## Install

```bash
pnpm add @cuped-io/flame @cuped-io/flame-react
```

For Next.js zero-flash SSR, also install [`@cuped-io/flame-edge`](https://www.npmjs.com/package/@cuped-io/flame-edge) and follow the [Next.js setup](#nextjs-app-router-with-zero-flash-ssr) below.

You'll need a DSN — get one at [cuped.io](https://cuped.io) under **Settings → Install snippet**.

## Usage (CSR / Vite / CRA)

```tsx
import { CupedProvider, useExperiment, Experiment, useObserve } from '@cuped-io/flame-react';

function App() {
  return (
    <CupedProvider dsn="https://YOUR_KEY@api.cuped.io">
      <Hero />
      <CheckoutButton />
    </CupedProvider>
  );
}

// Branch on variant
function Hero() {
  const { variant } = useExperiment('hero-cta');
  return <button>{variant?.name === 'treatment' ? 'Buy now' : 'Get started'}</button>;
}

// Or declaratively
function Hero2() {
  return (
    <Experiment
      id="hero-cta"
      variants={{
        control: <button>Get started</button>,
        treatment: <button>Buy now</button>,
      }}
    />
  );
}

// Track conversions
function CheckoutButton() {
  const observe = useObserve();
  return <button onClick={() => observe('checkout')}>Checkout</button>;
}
```

## Next.js App Router with zero-flash SSR

For Next.js, run variant resolution at the edge so the first server-rendered HTML already matches the assigned variant — no flash, no hydration mismatch.

Install all three packages:

```bash
pnpm add @cuped-io/flame @cuped-io/flame-react @cuped-io/flame-edge
```

Set env vars in `.env.local`:

```
CUPED_DSN=https://YOUR_KEY@api.cuped.io
NEXT_PUBLIC_CUPED_DSN=https://YOUR_KEY@api.cuped.io
CUPED_COOKIE_SECRET=<generate with: openssl rand -base64 32>
```

Both `CUPED_DSN` (server-side, for middleware) and `NEXT_PUBLIC_CUPED_DSN` (client-side, bundled) are needed and should hold the same value.

Three files:

**`middleware.ts`** — resolves at the edge, signs the result into a cookie:

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

**`app/providers.tsx`** — client component that mounts `<CupedProvider>` (it uses React hooks, so it must be a client boundary):

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

**`app/layout.tsx`** — server component that reads the signed cookie and passes the prehydrated state down:

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

Once wired, `useExperiment` and `<Experiment>` work the same as in CSR — they just render the assigned variant on the server too.

A complete working example lives at [`examples/next-app`](https://github.com/cuped-io/flame/tree/main/examples/next-app) in the source repo, including verification steps for cold-resolution, repeat visits, tampered/expired cookies, and graceful network-failure fallback.

## Peer dependencies

`react` ^18 || ^19, `react-dom` ^18 || ^19.

## Documentation

- [React + Next.js guide](https://cuped.io/docs/react-sdk) — canonical reference
- [Source on GitHub](https://github.com/cuped-io/flame/tree/main/packages/flame-react)

## License

MIT
