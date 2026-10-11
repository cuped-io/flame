---
'@cuped-io/flame': minor
---

Serve promoted winners. `/experiments/active` now lists concluded experiments whose winner was promoted under `promoted`, and the SDK applies each winner's changes through the same anti-flicker path as running experiments. It asks `/assign` for each one on every page load, so held-out visitors keep the original experience, and it ignores any stored assignment for that experiment without overwriting it, so a reverted promotion puts visitors back in their original variant. Promoted experiments attach nothing to events and register no goals. Previously a promoted experiment dropped out of `experiments` and every visitor reverted to the original. Edge-prehydrated (`@cuped-io/flame-edge`) pages don't serve promoted winners yet.
