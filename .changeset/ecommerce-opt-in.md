---
'@cuped-io/flame': minor
---

E-commerce auto-detection (add to cart, checkout and similar clicks) is now opt-in. Turn it on with `autoEcommerce: true` in `init()`, or with `data-ecommerce="true"` on the script tag. It was on for every site, its selectors could match unrelated buttons, and every match is a billable event.
