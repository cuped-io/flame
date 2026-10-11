---
'@cuped-io/flame': minor
---

Variants now survive single-page-app navigation and framework re-renders. flame keeps watching the page after the first apply. When an element a variant targets is re-created (for example, after navigating away and back within the app), flame applies the variant to it again. Your site's own later changes to an element flame already changed are left alone. Redirects are never re-applied. If the page keeps re-creating an element every time flame changes it, flame stops after 10 times in a second and logs why, so the two never fight. Turn it off with `data-reapply="false"` on the script tag, or `reapplyOnChange: false` in `init()`.
