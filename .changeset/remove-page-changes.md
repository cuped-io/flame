---
'@cuped-io/flame': minor
---

flame no longer holds any code that changes or hides the page (flame#63). The apply engine for the eight variant change types, redirects, rollback and markers, the anti-flicker coordination, the React hydration wait, the MutationObserver re-apply, the `history.pushState`/`replaceState` wrapping and the `click` events for changed elements are deleted.

- Removed exports: `VariantChange`, `TextChange`, `HtmlChange`, `AttributeChange`, `ClassChange`, `StyleChange`, `CssChange`, `VisibilityChange` and `RedirectChange`. `Variant` has no `changes` field.
- Removed `FlameConfig` options: `waitForHydration` and `reapplyOnChange`. The script tag no longer reads `data-wait-for-hydration` or `data-reapply`; a tag that still carries them works and they do nothing.
- The script-tag bundle (`flame.js`) shrinks from 8,331 to 8,009 bytes gzipped (24,876 to 23,788 bytes minified).
