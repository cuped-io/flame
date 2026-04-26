# @cuped-io/flame

Client-side A/B testing SDK for [cuped.io](https://cuped.io).

Drop a `<script>` tag on your page and define variants in the cuped.io dashboard, or import the SDK and drive variants from your own code.

## Install

```bash
pnpm add @cuped-io/flame
# or
npm install @cuped-io/flame
```

For React, see [`@cuped-io/flame-react`](https://www.npmjs.com/package/@cuped-io/flame-react). For zero-flash SSR, see [`@cuped-io/flame-edge`](https://www.npmjs.com/package/@cuped-io/flame-edge).

## Usage

### Script tag (no-code DOM mutations)

```html
<script
  src="https://cdn.cuped.io/flame.js"
  data-dsn="https://YOUR_KEY@api.cuped.io"
></script>
```

The SDK auto-initializes from the `data-dsn` attribute, fetches active experiments, applies variant DOM changes, and tracks observations.

### Programmatic

```ts
import { flame } from '@cuped-io/flame';

await flame.init({ dsn: 'https://YOUR_KEY@api.cuped.io' });

if (flame.isInVariant('hero-cta', 'treatment')) {
  // ...
}

flame.observe('signup', { plan: 'pro' });
```

## Public API

```ts
// Lifecycle
flame.init({ dsn, prehydrated? })

// Observations
flame.observe(eventType, metadata?)
flame.observePageview()
flame.observeConversion(metadata?)

// Identity
flame.identify(userId)
flame.clearIdentity()
flame.getUserId()
flame.getIdentity()

// Experiments
flame.getVariant(experimentId)
flame.getAssignedVariantInfo(experimentId)
flame.isInVariant(experimentId, variantOrName)
flame.isInitialized()
flame.reset()
```

## Variant change types

When using the script-tag flow, variants can apply 8 change types to the DOM via CSS selectors: `text`, `html`, `attribute`, `class`, `style`, `css`, `visibility`, `redirect`. Configured in the cuped.io dashboard.

## License

MIT
