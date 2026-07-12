---
'@cuped-io/flame': minor
---

Publish a versioned, integrity-pinnable CDN artifact.

The script-tag build now emits an immutable `flame@X.Y.Z.js` alongside the floating `flame.js`, plus a `flame.sri.json` manifest carrying the Subresource Integrity (sha384) hash for each path. Embedders can pin to the versioned path with `integrity` + `crossorigin="anonymous"` so a bad deploy can't silently reach every site, and can roll back by pointing at the previous version. The floating `flame.js` remains as an opt-in "latest" (unpinnable by design). See the install snippet in the README.
