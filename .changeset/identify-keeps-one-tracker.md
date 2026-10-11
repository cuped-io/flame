---
'@cuped-io/flame': patch
---

`identify()` and `clearIdentity()` now switch the user on the existing tracker instead of replacing it. Previously, after `identify()` the old click and submit listeners kept firing under the device ID and the new tracker never auto-tracked, so one visitor could count as two. After `clearIdentity()`, events kept the logged-in user's ID.
