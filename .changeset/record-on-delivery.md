---
'@cuped-io/flame': minor
---

Visitors are counted in a variant only once they are shown it. flame now asks cuped once for every experiment (`POST /evaluate`) and records a visitor's variant with a `$assignment` event at the moment it applies it, control included. A visitor whose page the anti-flicker timeout revealed before flame was ready sees the original and is no longer counted in a variant they never saw, and their events carry no experiment. The record goes out before the pageview and any event tagged with that variant, once per visitor per experiment. `init()` now resolves after the variants are applied or skipped, which on a page waiting for React to hydrate can be up to 5 seconds later. Requires a cuped API that serves `/evaluate`. Pages using `@cuped-io/flame-edge` are unchanged.
