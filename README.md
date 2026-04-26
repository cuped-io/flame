# flame

Client-side SDKs for [cuped.io](https://cuped.io) — A/B testing with CUPED variance reduction.

This repo is a pnpm workspace with three packages:

| Package | Role |
|---|---|
| [`@cuped-io/flame`](./packages/flame) | Core SDK. IIFE for `<script>` tag use; ESM/CJS for npm consumers. |
| [`@cuped-io/flame-react`](./packages/flame-react) | React bindings: `<CupedProvider>`, `useExperiment`, `<Experiment>`, `useObserve`. |
| [`@cuped-io/flame-edge`](./packages/flame-edge) | Edge-runtime resolver + signed cookie utilities for zero-flash SSR. Web Crypto only. |

## What it does

1. Fetches active experiments for a project
2. Assigns visitors to variants
3. Applies variant changes to the DOM (8 change types: `text`, `html`, `attribute`, `class`, `style`, `css`, `visibility`, `redirect`)
4. Auto-detects e-commerce events (add to cart, checkout, etc.)
5. Tracks observations with experiment assignments for server-side goal matching

## Quick start

**Script tag** (no-code DOM mutations):

```html
<script
  src="https://cdn.cuped.io/flame.js"
  data-dsn="https://YOUR_KEY@api.cuped.io"
></script>
```

**React / Next.js** (code-driven variants):

```bash
pnpm add @cuped-io/flame @cuped-io/flame-react
```

```tsx
import { CupedProvider, useExperiment } from '@cuped-io/flame-react';

<CupedProvider dsn="https://YOUR_KEY@api.cuped.io">
  <App />
</CupedProvider>;

function Hero() {
  const { variant } = useExperiment('hero-cta');
  return <button>{variant === 'treatment' ? 'Buy now' : 'Get started'}</button>;
}
```

For zero-flash SSR with Next.js App Router, also install `@cuped-io/flame-edge` and follow [`examples/next-app`](./examples/next-app).

## Examples

- [`examples/script-tag`](./examples/script-tag) — Static HTML page exercising all 8 change types.
- [`examples/next-app`](./examples/next-app) — Next.js App Router app with edge middleware + signed prehydrated cookie.

## Development

```bash
pnpm install
pnpm test         # all packages
pnpm typecheck
pnpm lint
pnpm build        # IIFE + ESM/CJS across packages
```

## License

MIT — see [LICENSE](./LICENSE).
