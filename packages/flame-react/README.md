# @cuped-io/flame-react

React bindings for the [cuped.io](https://cuped.io) A/B testing SDK.

Provides `<CupedProvider>`, `useExperiment`, `<Experiment>`, and `useObserve` so you can branch React components on variant assignment without touching the DOM directly.

## Install

```bash
pnpm add @cuped-io/flame @cuped-io/flame-react
```

For Next.js zero-flash SSR, also install [`@cuped-io/flame-edge`](https://www.npmjs.com/package/@cuped-io/flame-edge).

## Usage

```tsx
import { CupedProvider, useExperiment, Experiment, useObserve } from '@cuped-io/flame-react';

// Wrap your app
<CupedProvider dsn="https://YOUR_KEY@api.cuped.io">
  <App />
</CupedProvider>;

// Branch on variant
function Hero() {
  const { variant } = useExperiment('hero-cta');
  return <button>{variant === 'treatment' ? 'Buy now' : 'Get started'}</button>;
}

// Or declaratively
function Hero2() {
  return (
    <Experiment id="hero-cta" variants={{
      control: <button>Get started</button>,
      treatment: <button>Buy now</button>,
    }} />
  );
}

// Track conversions
function CheckoutButton() {
  const observe = useObserve();
  return <button onClick={() => observe('checkout')}>Checkout</button>;
}
```

## Zero-flash SSR

For zero-flash SSR, resolve assignments at the edge with `@cuped-io/flame-edge` and pass the prehydrated state to `<CupedProvider>`:

```tsx
import { CupedProvider } from '@cuped-io/flame-react';
import { readPrehydratedForServerComponent } from '@cuped-io/flame-edge/next';

export default async function RootLayout({ children }) {
  const prehydrated = await readPrehydratedForServerComponent();
  return (
    <CupedProvider dsn="https://YOUR_KEY@api.cuped.io" prehydrated={prehydrated}>
      {children}
    </CupedProvider>
  );
}
```

## Peer dependencies

`react` ^18 || ^19, `react-dom` ^18 || ^19.

## License

MIT
