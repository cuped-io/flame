# @cuped-io/flame

[![npm](https://img.shields.io/npm/v/@cuped-io/flame)](https://www.npmjs.com/package/@cuped-io/flame)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cuped-io/flame/blob/main/LICENSE)

Client-side A/B testing SDK for [cuped.io](https://cuped.io).

Drop a `<script>` tag on your page and define variants in the cuped.io dashboard, or import the SDK and drive variants from your own code.

## Install

```bash
pnpm add @cuped-io/flame
# or
npm install @cuped-io/flame
```

For React, see [`@cuped-io/flame-react`](https://www.npmjs.com/package/@cuped-io/flame-react). For Next.js zero-flash SSR, also see [`@cuped-io/flame-edge`](https://www.npmjs.com/package/@cuped-io/flame-edge).

You'll need a DSN — get one at [cuped.io](https://cuped.io) under **Settings → Install snippet**.

## Usage

### Script tag (no-code DOM mutations)

Pin to a version and guard it with [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) — `crossorigin` is required for SRI on the cross-origin script:

```html
<script
  src="https://cdn.cuped.io/flame@0.4.0.js"
  integrity="sha384-zV6If+2sDPRrWSbiaFZ2P5A4fBe6uIqixLvv3rAeMZrqbztP4P/8s0fRfAQxr2TD"
  crossorigin="anonymous"
  data-dsn="https://YOUR_KEY@api.cuped.io"
></script>
```

The SDK auto-initializes from the `data-dsn` attribute, fetches active experiments, applies variant DOM changes, and tracks events. Define the changes per variant in the cuped.io dashboard.

The SRI hash for every published version is listed in [`cdn.cuped.io/flame.sri.json`](https://cdn.cuped.io/flame.sri.json) (a `versions` map plus a `latest` pointer). Pinned `flame@X.Y.Z.js` URLs are write-once and never removed, so a pin keeps resolving byte-for-byte across all later releases and can always be rolled back to. The unversioned `https://cdn.cuped.io/flame.js` is a floating "latest" that always serves the newest release — convenient, but it can't be SRI-pinned (its bytes change on every release) and gives up rollback safety.

### Programmatic

```ts
import { flame } from '@cuped-io/flame';

await flame.init({ dsn: 'https://YOUR_KEY@api.cuped.io' });

if (flame.isInVariant('hero-cta', 'treatment')) {
  // ...
}

// Fire any custom event. Define a matching goal once at the project
// level on cuped.io (Project → Goals → Custom event); any experiment
// in the project can then attach it as primary or secondary.
flame.track('vote_cast', { game_id: 'g42', option: 'controller' });
```

The SDK POSTs every event to `POST /{api_key}/events` as the array
envelope `{ "events": [ … ] }` (a single event is an array of one).

## Public API

```ts
// Lifecycle
flame.init({ dsn, prehydrated? })

// Events — one verb. Use track('pageview') on SPA navigation and
// track('conversion', …) for conversions.
flame.track(eventType, metadata?)

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

## Documentation

- [Script-tag SDK](https://cuped.io/docs/sdk)
- [REST API](https://cuped.io/docs/api)
- [Source on GitHub](https://github.com/cuped-io/flame/tree/main/packages/flame)

## License

MIT
