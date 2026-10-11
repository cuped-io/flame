---
'@cuped-io/flame': patch
'@cuped-io/flame-edge': patch
'@cuped-io/flame-react': minor
---

Handle `/assign` answers with no variant — held out, workspace at its event cap, or workspace archived — as a normal outcome: render the original, attach no assignment to events, surface no error or warning, and don't persist the refusal to localStorage. `@cuped-io/flame-edge` leaves such experiments out of the prehydrated cookie.

**Behavior change in `@cuped-io/flame-react`:** `<Experiment>` now renders its `fallback` only while loading. Once loaded, a user in no variant (held out, or not enrolled) gets `variants.control` — previously they kept seeing `fallback` indefinitely.
