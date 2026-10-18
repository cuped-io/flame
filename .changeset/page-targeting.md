---
'@cuped-io/flame': minor
---

Experiments can target pages. When cuped sends an experiment's `url_pattern` (the goals' syntax: `/pricing`, `/product/*`, `/checkout/**`, `**/confirmation`), flame assigns, counts and changes a visitor only on a page whose path matches, so visitors who never saw the page no longer dilute the result. On other pages the experiment is skipped, though a visitor already counted keeps their variant on their events, so later conversions are attributed. Single-page apps are re-checked on `pushState`, `replaceState` and back/forward, and only when some experiment has a pattern. Each `$assignment` record now carries the `path` it was delivered on, which cuped checks against the pattern. Experiments without a pattern run on every page, as before. Arms resolved by `@cuped-io/flame-edge` are gated the same way. `@cuped-io/flame-react`'s `useExperiment` and `<Experiment>` do not check the pattern: a component renders its arm wherever it is placed.
