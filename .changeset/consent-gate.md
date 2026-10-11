---
'@cuped-io/flame': minor
---

Consent support. With `requireConsent: true` (script tag: `data-consent="required"`), flame does nothing until `flame.consent(true)`: no ID, no storage, no network, and the original page shows. Accepting assigns and applies the variant on the current page and starts tracking. `consentApply: 'next-page'` (`data-consent-apply="next-page"`) waits for the next page load instead, which excludes single-page apps and single landing pages. `flame.consent(false)` sends nothing more: queued events are dropped, not sent, and the stored ID, assignments and retry queue are deleted. The choice is remembered on later pages. A browser Global Privacy Control or Do Not Track signal keeps flame off, and `consent(true)` then returns `'blocked_by_signal'` and logs why. `flame.consentState()` reports where things stand. Experiments measure consenting visitors only.
