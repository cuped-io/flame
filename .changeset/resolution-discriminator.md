---
'@cuped-io/flame': minor
'@cuped-io/flame-edge': minor
---

flame and flame-edge now read the one `resolution` field that cuped's `/assign` and `/evaluate` answers carry (`assigned`, `promoted_winner`, `held_out`, `cap_reached` or `workspace_archived`), not the three booleans it replaces (`held_out`, `cap_reached`, `workspace_archived`). flame exports the `Resolution` type. Requires a cuped API that sends `resolution`. With an older API, flame renders the original experience and flame-edge asks again later.
