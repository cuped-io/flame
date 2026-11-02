---
'@cuped-io/flame': minor
'@cuped-io/flame-react': patch
---

Every request flame makes to cuped now has a time limit, 10 seconds by default (flame#58). Set it with the new `requestTimeoutMs` option. A request that runs out counts as failed: with no stored rules file, reads answer control and `init()` completes, and an event batch is kept and sent again, as after a network error. In flame-react, `isLoading` becomes false when the limit passes, whatever `loadingLimitMs` is.
