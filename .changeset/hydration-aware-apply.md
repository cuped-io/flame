---
'@cuped-io/flame': minor
---

On server-rendered React sites, flame now waits for React to hydrate an element before applying a variant to it. Applying earlier made React throw error #418 (hydration mismatch) in your app and discard the variant. This is automatic on Next.js, Remix, React Router 7 and Gatsby. For other React server-rendered pages, add `data-wait-for-hydration="true"` to the script tag (or `waitForHydration: true` in `init()`); `"false"` turns it off. If hydration has not happened within 5 seconds, flame applies anyway.
