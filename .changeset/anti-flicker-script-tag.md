---
'@cuped-io/flame': minor
---

Anti-flicker for the script-tag SDK (#16). When an anti-flicker hide snippet is present on the page, flame now reveals the page the moment variants are applied — coordinating through `window.__cupedAntiflicker` — so the control never flashes before the treatment. The reveal is idempotent and race-safe with the snippet's timeout fallback: if the timeout already revealed the original (slow or failed API), flame skips a late variant apply so there's no late flash, and those visitors stay on control. Fully backward-compatible: a no-op when no anti-flicker snippet is present.
