# @cuped-io/flame-edge

[![npm](https://img.shields.io/npm/v/@cuped-io/flame-edge)](https://www.npmjs.com/package/@cuped-io/flame-edge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cuped-io/flame/blob/main/LICENSE)

Edge-runtime resolver + signed cookie utilities for [cuped.io](https://cuped.io) zero-flash SSR.

Resolves variant assignments at the edge before the first byte is rendered, signs them into a cookie, and hands them to `@cuped-io/flame-react` so server-rendered HTML matches the assigned variant from request #1.

Web Crypto only — no Node `crypto`. Runs on Vercel Edge, Cloudflare Workers, Deno Deploy, etc.

## Install

```bash
pnpm add @cuped-io/flame @cuped-io/flame-react @cuped-io/flame-edge
```

You'll need a DSN — get one at [cuped.io](https://cuped.io) under **Settings → Install snippet**.

## Next.js App Router

Set env vars in `.env.local`:

```
CUPED_DSN=https://YOUR_KEY@api.cuped.io
NEXT_PUBLIC_CUPED_DSN=https://YOUR_KEY@api.cuped.io
CUPED_COOKIE_SECRET=<generate with: openssl rand -base64 32>
```

`CUPED_DSN` is used server-side by the middleware; `NEXT_PUBLIC_CUPED_DSN` is bundled to the client for the React provider. They should hold the same value.

**`middleware.ts`**:

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

**`app/providers.tsx`** — `CupedProvider` uses React hooks, so wrap it in a client component:

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

**`app/layout.tsx`** — server component that reads the signed cookie and passes prehydrated state down:

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

A complete working example with verification steps lives at [`examples/next-app`](https://github.com/cuped-io/flame/tree/main/examples/next-app).

## Framework-agnostic

For non-Next.js edge runtimes (Cloudflare Workers, Remix, TanStack Start, SvelteKit, etc.), use the lower-level primitives:

```ts
import { resolveAssignments, readPrehydratedFromCookieHeader } from '@cuped-io/flame-edge';

// In your edge handler:
const result = await resolveAssignments({
  dsn: process.env.CUPED_DSN!,
  request,                                    // Web standard Request
  secret: process.env.CUPED_COOKIE_SECRET!,
});

// result.prehydrated → pass to <CupedProvider prehydrated={...}>
// result.setCookie  → attach as Set-Cookie header on the response
```

To later read the cookie back during render:

```ts
const prehydrated = await readPrehydratedFromCookieHeader(
  request.headers.get('cookie') ?? '',
  process.env.CUPED_COOKIE_SECRET!,
);
```

## What you get

- Cold visit → resolve at edge → sign cookie → render correct variant
- Repeat visit → read signed cookie → skip API roundtrip → render correct variant
- Tampered/expired cookies → reject and re-resolve
- Network failure → graceful degradation to client-side init

## Peer dependencies

`next` ^13 || ^14 || ^15 (optional — only needed for the `/next` subpath).

## Documentation

- [React + Next.js guide](https://cuped.io/docs/react-sdk)
- [Source on GitHub](https://github.com/cuped-io/flame/tree/main/packages/flame-edge)

## License

MIT
