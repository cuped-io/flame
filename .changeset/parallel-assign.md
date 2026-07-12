---
'@cuped-io/flame': patch
---

Parallelize experiment assignment on init (#17). The script-tag SDK previously requested assignments in a serial loop — N experiments meant N sequential `/assign` round-trips, so a slow API compounded per experiment (and delayed variant application). Assignments now resolve concurrently in a single batch, with registration order preserved. No API change; a slow API now costs one round-trip, not N.
