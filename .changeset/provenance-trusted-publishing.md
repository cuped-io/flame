---
"@cuped-io/flame": patch
"@cuped-io/flame-react": patch
"@cuped-io/flame-edge": patch
---

Releases now ship with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) attestations. Every published tarball is cryptographically tied to the exact GitHub Actions workflow run that produced it (visible as a "Provenance" badge on npmjs.com), and publishes are authenticated via OIDC trusted publishing rather than long-lived tokens.
