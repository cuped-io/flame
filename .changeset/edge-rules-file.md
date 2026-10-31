---
'@cuped-io/flame-edge': minor
'@cuped-io/flame': minor
---

flame-edge picks new visitors' arms from a cached rules file, with no wait and a small cookie (flame#62).

- Each runtime keeps an in-memory copy of the project's rules file, refreshed in the background about once a minute. Arms are picked with flame's own pick and Holdout draw, from the new `@cuped-io/flame/rules` export. A request never waits on ember: `timeoutMs` is gone, and `/experiments/active` and `/evaluate` are no longer called.
- With no rules copy yet, `resolveAssignments` answers `{ prehydrated: null }` at once and the browser picks.
- Each request reconciles the visitor's arms with the current rules: a newly started experiment gets an arm, a stopped one drops out, and an arm already held stays when the weights change. The declined-retry logic is gone.
- The signed cookie (v2) holds only the visitor id, when it was issued, and an 8-character token per arm. It stays under 1 KB with 20 experiments. A v1 cookie keeps its visitor and arms and is re-signed.
- `signPrehydrated`/`verifyAndDecode`/`RetryState` are replaced by `signVisitor`/`verifyVisitor`/`Visitor`.
- `readPrehydratedFromCookieHeader(header, { dsn, secret })` and `readPrehydratedForServerComponent(cookies, { dsn, secret })` now take the DSN: the experiments come from the rules copy, not the cookie.
- `resolveAssignments` takes `waitUntil`. `createCupedMiddleware` passes Next's `event.waitUntil`, and puts a newly signed cookie on the request it passes on, so the server render has the arms on the first visit. `buildResponse` receives that `NextResponse.next()` init.
