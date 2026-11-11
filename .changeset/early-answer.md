---
'@cuped-io/flame-react': minor
'@cuped-io/flame': patch
---

A returning visitor's saved arm is on flame-react's first render, with `isLoading` false (flame#65).

- The saved arm is there on a render that is not a hydration, from flame's stored rules file. A hydration gives what the server render gave, so the HTML matches, and the saved arm comes on the render just after it. A server-rendered page uses `prehydrated` to avoid that loading render.
- A hydration no longer differs from the server render when flame is already ready in the browser.
- Under React Strict Mode, `CupedProvider` starts flame once.
- Once flame is ready, a fresh rules file that stopped the experiment can change the saved arm to control.
- flame: an internal `earlyArms` helper in `@cuped-io/flame/rules`, for flame-react. It is not part of flame's API.
