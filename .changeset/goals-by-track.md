---
'@cuped-io/flame': minor
---

flame no longer listens to clicks and form submits for goals, and e-commerce auto-detection is gone. A `click`, `submit` or `custom` goal is now counted only when your page fires an event by its name with `flame.track(goal.name)` (or `useTrack()`); cuped matches goals by event name, so the goal's selector is no longer read. The `autoEcommerce` option, the `data-ecommerce` script attribute and the `getEcommerceGoals` and `getActiveEcommerceGoals` exports are removed. The automatic pageview, `track()`, and the experiments they carry are unchanged, as are the `click` events flame sends for clicks on elements a variant changed.
