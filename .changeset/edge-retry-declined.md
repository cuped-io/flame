---
'@cuped-io/flame-edge': minor
---

Ask `/assign` again for experiments that were declined because the workspace was at its event cap or archived. Previously the signed cookie kept that refusal for its whole life (30 days by default), so edge-resolved users stayed unenrolled long after an upgrade, billing reset or revive. The cookie now records declined experiments with a retry time; once it passes, the edge re-asks for just those, as the same user, and re-signs the cookie. A per-experiment API failure is retried the same way, and a failed retry backs off rather than costing every request a timeout. Held-out users are never re-asked. Older cookies remain valid.
