# @cuped-io/flame

[![npm](https://img.shields.io/npm/v/@cuped-io/flame)](https://www.npmjs.com/package/@cuped-io/flame)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/cuped-io/flame/blob/main/LICENSE)

Client-side A/B testing SDK for [cuped.io](https://cuped.io).

Drop a `<script>` tag on your page or import the SDK, then read each visitor's variant from your own code.

## Install

```bash
pnpm add @cuped-io/flame
# or
npm install @cuped-io/flame
```

For React, see [`@cuped-io/flame-react`](https://www.npmjs.com/package/@cuped-io/flame-react). For Next.js zero-flash SSR, also see [`@cuped-io/flame-edge`](https://www.npmjs.com/package/@cuped-io/flame-edge).

You'll need a DSN — get one at [cuped.io](https://cuped.io) under **Settings → Install snippet**.

## Usage

### Script tag

Pin to a version and guard it with [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) — `crossorigin` is required for SRI on the cross-origin script:

```html
<script
  src="https://cdn.cuped.io/flame@0.5.0.js"
  integrity="sha384-EyZs8bbbc37P0vhn5CdDiwF5Ph/dgG7+92yeULGePA4XIUw52Wx2qWQvs+hsdrLk"
  crossorigin="anonymous"
  data-dsn="https://YOUR_KEY@api.cuped.io"
></script>
```

The SDK auto-initializes from the `data-dsn` attribute, picks the visitor's variants from your project's rules file, and tracks events. It never changes or hides the page: your code reads the variant and renders it.

```html
<script>
  window.addEventListener('flame:ready', () => {
    if (flame.getVariant('hero-cta') === 'VARIANT_ID') {
      // render the treatment
    }
  });
</script>
```

The SRI hash for every published version is listed in [`cdn.cuped.io/flame.sri.json`](https://cdn.cuped.io/flame.sri.json) (a `versions` map plus a `latest` pointer). Pinned `flame@X.Y.Z.js` URLs are write-once and never removed, so a pin keeps resolving byte-for-byte across all later releases and can always be rolled back to. The unversioned `https://cdn.cuped.io/flame.js` is a floating "latest" that always serves the newest release — convenient, but it can't be SRI-pinned (its bytes change on every release) and gives up rollback safety.

### Programmatic

```ts
import { flame } from '@cuped-io/flame';

await flame.init({ dsn: 'https://YOUR_KEY@api.cuped.io' });

if (flame.isInVariant('hero-cta', 'Treatment')) {
  // ...
}

// Fire any custom event. Define a matching goal once at the project
// level on cuped.io (Project → Goals → Custom event); any experiment
// in the project can then attach it as primary or secondary.
flame.track('vote_cast', { game_id: 'g42', option: 'controller' });
```

### How flame picks and records a variant

- **Picking.** flame fetches your project's rules file (`GET /{api_key}/rules`, cached at the edge for about a minute) and picks each new visitor's variant on the device, with the same hash cuped's server uses. It keeps a copy, so a returning visitor's variants are known before any request; the copy is refreshed in the background. A visitor in the project's Holdout gets control, and a promoted winner is served to everyone else. A `prehydrated` answer from `@cuped-io/flame-edge` is used as is.
- **Ready.** `flame.ready` is a promise that resolves once reads answer, and flame dispatches a `flame:ready` event on `window` at the same moment (again when a consent grant starts flame). Wait on either instead of polling `isInitialized()`. If the rules file cannot be fetched and there is no stored copy, flame is still ready and every read answers control.
- **Exposure on read.** A visitor is counted in an experiment only when your code reads it: the first `getVariant`, `getAssignedVariantInfo` or `isInVariant` call for that experiment records a `$assignment` with the page path, once per visitor and variant. An experiment your page never reads is never recorded. A read before flame is ready returns `null` (show control) and records nothing. Control given to a Holdout member, a promoted winner, and control on a page outside the experiment's URL pattern are never recorded.
- **Events.** The pageview goes out as soon as flame starts. `track()` events carry only the variants recorded so far, including those recorded on earlier visits.

The SDK POSTs every event to `POST /{api_key}/events` as the array
envelope `{ "events": [ … ] }` (a single event is an array of one).

## Public API

```ts
// Lifecycle
flame.init({ dsn, prehydrated? })
flame.ready            // Promise<void>; also the 'flame:ready' event on window

// Events — one verb. Use track('pageview') on SPA navigation and
// track('conversion', …) for conversions.
flame.track(eventType, metadata?)

// Identity
flame.identify(userId)
flame.clearIdentity()
flame.getUserId()
flame.getIdentity()

// Experiments: key is the experiment's slug or id. A read records exposure.
flame.getVariant(key)                 // variant id, or null: show control
flame.getAssignedVariantInfo(key)     // { id, name, is_control, ... } or null
flame.isInVariant(key, variantIdOrName)
flame.isInitialized()
flame.reset()
```

## Page targeting

An experiment can set a URL pattern in the cuped.io dashboard, using the same syntax as goals: `/pricing`, `/product/*` (one segment), `/checkout/**` (the path and anything beneath it), or `**/confirmation` (any path ending in it). A read on a page whose path does not match returns control and records nothing, unless the visitor was already recorded in that experiment, so a conversion on another page is still attributed. An experiment with no pattern runs on every page.

## Documentation

- [Script-tag SDK](https://cuped.io/docs/sdk)
- [REST API](https://cuped.io/docs/api)
- [Source on GitHub](https://github.com/cuped-io/flame/tree/main/packages/flame)

## License

MIT
