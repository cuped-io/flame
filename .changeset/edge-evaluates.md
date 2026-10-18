---
'@cuped-io/flame-edge': minor
'@cuped-io/flame': minor
---

flame-edge no longer counts visitors in experiments they never see. On a cookie miss it now asks cuped once for every experiment (`POST /evaluate`), which writes no assignment, instead of calling `/assign` per experiment. flame records each prehydrated variant with a `$assignment` event when it delivers it, control included, exactly as it does for variants it resolves itself. A prehydrated variant the anti-flicker timeout skipped is no longer counted or attached to events. A cookie retry after an event cap or archive also uses `/evaluate`. If that one call fails on a first visit, no cookie is set and the page resolves in the browser, as when the API is unreachable. Requires a cuped API that serves `/evaluate`.
