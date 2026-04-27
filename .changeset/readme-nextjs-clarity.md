---
"@cuped-io/flame": patch
"@cuped-io/flame-react": patch
"@cuped-io/flame-edge": patch
---

Improve READMEs for clarity and correctness, especially for the Next.js App Router setup. Adds version + license badges, direct npmjs.com links, and a Documentation section pointing to the canonical guide on cuped.io.

Fixes two bugs in the prior zero-flash code samples that would not have compiled if copy-pasted:

- `createCupedMiddleware` takes `secret`, not `cookieSecret`
- `readPrehydratedForServerComponent` requires `(cookieStore, secret)` — both args are needed

The samples now show the canonical `app/providers.tsx` + `app/layout.tsx` split (CupedProvider uses React hooks and must be wrapped in a `'use client'` component before being mounted from a server component) plus a complete `.env.local` template and the `openssl rand -base64 32` cookie-secret generation step.
