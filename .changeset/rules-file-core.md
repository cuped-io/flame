---
'@cuped-io/flame': minor
---

flame picks each visitor's variants on the device from your project's rules file (`GET /{api_key}/rules`), with no wait on cuped's server, and counts a visitor in an experiment only when your code reads it (flame#24).

- `getVariant`, `getAssignedVariantInfo` and `isInVariant` take the experiment's slug or id, and answer at once. The first read of the visitor's variant records it with the page path; an experiment your page never reads is never recorded. A read before flame is ready returns `null` and records nothing.
- New: `flame.ready`, a promise that resolves once reads answer, and the `flame:ready` event on `window` at the same moment.
- A stored copy of the rules file serves returning visitors at once and is refreshed in the background. If the rules file cannot be fetched and no copy is stored, every read answers control and init still completes.
- Holdout members read control and promoted winners are served from the rules file; neither is recorded.
- The pageview goes out as soon as flame starts. `track()` events carry only recorded variants.
- flame no longer calls `/experiments/active` or `/evaluate`, and no longer changes the page, coordinates with the anti-flicker snippet or sends `click` events for changed elements. Remove the anti-flicker snippet: flame no longer reveals the page it hides.
- `Variant`'s `description`, `created_at` and `updated_at` are optional, since the rules file does not carry them.
