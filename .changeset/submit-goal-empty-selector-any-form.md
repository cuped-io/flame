---
'@cuped-io/flame': patch
---

A **Form Submit** goal with no CSS selector now fires on any form
submission on the page, instead of silently never firing. The
auto-tracker previously skipped every click/submit goal whose selector
was empty, so a no-code "track any form submit as a conversion" goal
collected no data and gave no error. Submit goals with a selector are
unchanged (they still fire only when the submitted form matches), and
click goals still require a selector — an empty-selector click goal has
no target to bind to and remains observable only via `flame.observe()`.
