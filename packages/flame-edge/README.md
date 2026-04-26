# @cuped-io/flame-edge

Edge-runtime resolver + signed cookie utilities for [cuped.io](https://cuped.io) zero-flash SSR.

Resolves variant assignments at the edge before the first byte is rendered, signs them into a cookie, and hands them to `@cuped-io/flame-react` so server-rendered HTML matches the assigned variant from request #1.

Web Crypto only — no Node `crypto`. Runs on Vercel Edge, Cloudflare Workers, Deno Deploy, etc.

## Install

```bash
pnpm add @cuped-io/flame @cuped-io/flame-edge
```

## Usage

### Next.js App Router

`middleware.ts`:

```ts
import { createCupedMiddleware } from '@cuped-io/flame-edge/next';

export default createCupedMiddleware({
  dsn: process.env.CUPED_DSN!,
  cookieSecret: process.env.CUPED_COOKIE_SECRET!,
});

export const config = { matcher: '/((?!_next|api|favicon).*)' };
```

`app/layout.tsx`:

```tsx
import { CupedProvider } from '@cuped-io/flame-react';
import { readPrehydratedForServerComponent } from '@cuped-io/flame-edge/next';

export default async function RootLayout({ children }) {
  const prehydrated = await readPrehydratedForServerComponent();
  return (
    <html>
      <body>
        <CupedProvider dsn={process.env.NEXT_PUBLIC_CUPED_DSN!} prehydrated={prehydrated}>
          {children}
        </CupedProvider>
      </body>
    </html>
  );
}
```

### Framework-agnostic

```ts
import { resolveAssignments, readPrehydratedFromCookieHeader } from '@cuped-io/flame-edge';

const prehydrated = await resolveAssignments({
  dsn: 'https://YOUR_KEY@api.cuped.io',
  cookieSecret: process.env.COOKIE_SECRET!,
  cookieHeader: request.headers.get('cookie'),
});
```

## What you get

- Cold visit → resolve at edge → sign cookie → render correct variant
- Repeat visit → read signed cookie → skip API roundtrip → render correct variant
- Tampered/expired cookies → reject and re-resolve
- Network failure → graceful degradation to client-side init

## Peer dependencies

`next` ^13 || ^14 || ^15 (optional — only needed for the `/next` subpath).

## License

MIT
