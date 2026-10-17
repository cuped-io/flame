---
'@cuped-io/flame': patch
---

Withdrawing consent, or calling `reset()`, while flame is still fetching experiments now stops that start. Before, the answer arriving afterwards still registered the visitor's arms, applied promoted winners, watched the page for re-created targets and logged "Failed to initialize"; after a `reset()` it also applied the variant and sent its `$assignment` record.
