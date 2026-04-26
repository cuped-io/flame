# cuped.io flame — script-tag test page

Static HTML page exercising each of flame's 8 change types. Open in
a browser with flame loaded against your project to verify changes
apply correctly.

This is the testing complement to `examples/next-app/` (which covers
the React SDK + zero-flash SSR path). Use this one for:

- Verifying flame 0.2.0+ change types after a release
- Pre-deployment smoke tests for the script-tag flow
- Reproducing customer-reported variant rendering issues without
  needing their site

## Setup

```bash
# 1. Build flame so dist/flame.js exists
cd /home/mike/flame
pnpm --filter @cuped-io/flame build

# 2. Edit examples/script-tag/index.html — replace REPLACE_WITH_YOUR_DSN
#    with your project DSN.

# 3. Serve the directory (the script tag uses a relative path)
cd examples/script-tag
python3 -m http.server 8080
# or: npx http-server -p 8080
```

Open <http://localhost:8080>. The page has 8 sections, one per
change type. Each section shows the target element and a JSON
snippet of the variant change that targets it.

## Configure experiments to test each change type

In your cuped dashboard, create one experiment per change type (or
one with multiple changes per variant). Match variants up like:

| Section | Selector | Suggested variant change |
|---|---|---|
| 1. text | `#target-text` | `{ type: "text", selector: "#target-text", value: "Replaced!" }` |
| 2. html | `#target-html` | `{ type: "html", selector: "#target-html", value: "<strong>Replaced markup</strong>" }` |
| 3. attribute | `#target-attribute` | `{ type: "attribute", selector: "#target-attribute", attribute: "href", value: "https://example.com/new" }` |
| 4. class | `#target-class` | `{ type: "class", selector: "#target-class", add: ["new-class"], remove: ["remove-me"] }` |
| 5. style | `#target-style` | `{ type: "style", selector: "#target-style", styles: { "color": "#10b981", "font-weight": "700" } }` |
| 6. css | (no selector — global) | `{ type: "css", css: ".target-css { background: #fef3c7; }" }` |
| 7. visibility | `#target-visibility` | `{ type: "visibility", selector: "#target-visibility", visible: false }` |
| 8. redirect | (no selector) | `{ type: "redirect", url: "/some-page" }` |

Status: `running`. Set the user to the variant of your choice from
the dashboard or just take whichever assignment you get on first
visit.

## What to verify

1. **flame loads.** Console shows `[Flame] Initialized` debug logs.
   `window.flame` is defined.
2. **API calls fire.** Network tab shows
   `GET /:dsn/experiments/active` and
   `POST /:dsn/experiments/:id/assign` per experiment.
3. **The target element changes** match the configured variant change.
4. **Identity is persistent.** "Show identity" button dumps the
   device id; reload → same id.
5. **Observations fire.** "Fire observation" button → Network shows
   `POST /:dsn/observations` (or buffered + flushed via batch).

## Real-world testing on a production site

For a more realistic test target, point flame at a live site and
watch behavior under real DOM and real traffic. Suggested first
steps on a production target:

1. In cuped, create an experiment with a variant change targeting an
   inert element (e.g. a footer link's text or class). Avoid change
   types that could affect a critical user flow on first try.
2. Load the site and verify the change applied.
3. Watch the Network tab for observations on the existing
   e-commerce auto-detection (add_to_cart, checkout, etc.) — these
   should still fire as before.
4. Roll the experiment back when you're done.

Caveats for sites with async-rendered DOM (e.g. Shopify themes,
SPAs):
- flame's `DOMContentLoaded` hook catches most pages, but for
  elements rendered by a framework after page load you may see a
  brief flicker of the original.
- The `redirect` change type is **risky on a live store** — only use
  on test pages.

## Limitations

- This page doesn't cover the React SDK or SSR — see
  `examples/next-app/`.
- No automated assertions. Future work: Playwright snapshot tests
  against this page with mocked cuped responses.
