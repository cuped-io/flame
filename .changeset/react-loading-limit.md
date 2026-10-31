---
'@cuped-io/flame-react': minor
---

flame-react runs on the new core (flame#61). `useExperiment` and `<Experiment>` take the experiment's slug or id.

- `isLoading` lasts at most the provider's new `loadingLimitMs` prop, 200 ms by default. If the limit passes before flame knows a new visitor's arm, that experiment shows control for the rest of the page view, even if the arm arrives later, and nothing is recorded. `0` means never wait.
- With a flame-edge answer (`prehydrated`) or a flame that is already ready, the first render has the arm and `isLoading` is false.
- A visitor is recorded in an experiment when a `useExperiment` or `<Experiment>` for it renders a real arm, not when the provider starts. Experiments no rendered component asks for are never recorded.
