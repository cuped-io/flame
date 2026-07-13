---
'@cuped-io/flame': patch
---

Buffer events tracked before init (#20). `track()` / `useTrack()` called before the SDK finished initializing previously dropped the event silently — contradicting `useTrack`'s documented behavior. Pre-init events are now buffered and delivered once init completes, carrying the active experiment assignments. Also removed an unused internal URL-pattern matcher (dead code — the backend is the source of truth for pageview-goal URL matching).
