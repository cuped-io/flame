---
'@cuped-io/flame': patch
---

flame decides whether to send a refused batch of events again by the refusal's `code` (ember#364), not its status: `rate_limited` and `ingest_unavailable` are retried, and every other code is dropped. A refusal with no `code` flame knows is still judged by its status: a 5xx, 408 or 429 is retried (flame#66).
