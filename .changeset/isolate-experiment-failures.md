---
'@cuped-io/flame': patch
---

One failing experiment no longer stops the others. A failed assignment request or an invalid CSS selector now affects only that experiment: the rest still apply, the pageview is still tracked, and an anti-flicker page is always revealed instead of waiting for its timeout.
