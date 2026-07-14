import {
  integrityHash,
  LATEST_NAME,
  MANIFEST_NAME,
  parseVersionedName,
  projectSriManifest,
  serialiseManifest,
  versionedName,
  type CdnManifest,
} from './cdn-artifacts';

/**
 * Release-time CDN publishing against the write-once R2 bucket
 * (ember ADR-0021/0022). Orchestration only — the store is injected so the
 * write-once and projection semantics are unit-testable without R2; the
 * real S3-API adapter lives in `./r2-store.ts`.
 *
 * Publish order for a release of `version`:
 *   1. Conditional-PUT the pinned `flame@X.Y.Z.js` (write-once: identical
 *      bytes re-run is a no-op, differing bytes hard-fail the release).
 *   2. List the bucket and project `flame.sri.json` from every pinned
 *      artifact present — the manifest is a function of the bucket, never
 *      an append onto the previous manifest.
 *   3. Only if `version` is the newest published version, overwrite the
 *      floating `flame.js` with its bytes ("floating = latest released",
 *      ADR-0022 — a re-run for an older version must not move it back).
 *   4. Overwrite the manifest.
 */

const encoder = new TextEncoder();

/** The minimal object-store surface the publish flow needs. */
export interface CdnObjectStore {
  /**
   * Create `key` only if it does not exist (S3 `If-None-Match: *`).
   * Returns 'created', or 'conflict' when the key already exists.
   */
  putIfAbsent(key: string, body: Uint8Array, contentType: string): Promise<'created' | 'conflict'>;
  /** Unconditional overwrite — only the floating + manifest paths use this. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Full object bytes, or null when the key does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Every key in the bucket. */
  list(): Promise<string[]>;
}

export const SCRIPT_CONTENT_TYPE = 'application/javascript; charset=utf-8';
export const MANIFEST_CONTENT_TYPE = 'application/json; charset=utf-8';

export interface PublishCdnReleaseInput {
  store: CdnObjectStore;
  version: string;
  /** The built IIFE bytes for `version` (contents of dist/flame.js). */
  iife: Uint8Array;
}

export interface PublishCdnReleaseResult {
  pinned: 'created' | 'unchanged';
  /** Whether the floating flame.js was (re)written to this version's bytes. */
  floatingUpdated: boolean;
  manifest: CdnManifest;
}

export async function publishCdnRelease({
  store,
  version,
  iife,
}: PublishCdnReleaseInput): Promise<PublishCdnReleaseResult> {
  const pinnedName = versionedName(version);

  let pinned: 'created' | 'unchanged';
  const putResult = await store.putIfAbsent(pinnedName, iife, SCRIPT_CONTENT_TYPE);
  if (putResult === 'created') {
    pinned = 'created';
  } else {
    // The version key already exists. Identical bytes means a re-run of an
    // already-published release — an idempotent no-op. Differing bytes
    // means something tried to change a published pin: fail the release
    // loudly rather than break every embedder verifying that pin's SRI.
    const existing = await store.get(pinnedName);
    if (existing === null) {
      throw new Error(`${pinnedName} conflicted on write but could not be read back`);
    }
    if (!bytesEqual(existing, iife)) {
      throw new Error(
        `${pinnedName} is already published with different bytes ` +
          `(published ${integrityHash(existing)}, attempted ${integrityHash(iife)}). ` +
          'Pinned artifacts are write-once; bump the version instead.',
      );
    }
    pinned = 'unchanged';
  }

  const manifest = await projectManifestFromStore(store);

  // "Floating = latest released" (ADR-0022). Releases are monotonic, so in
  // the normal case `version` is the manifest's latest; the guard only
  // matters for a re-run of an older release, which must not drag the
  // floating path backwards.
  const floatingUpdated = manifest.latest === version;
  if (floatingUpdated) {
    await store.put(LATEST_NAME, iife, SCRIPT_CONTENT_TYPE);
  }

  await store.put(MANIFEST_NAME, encoder.encode(serialiseManifest(manifest)), MANIFEST_CONTENT_TYPE);

  return { pinned, floatingUpdated, manifest };
}

/**
 * Project the SRI manifest from what is actually in the bucket: hash every
 * pinned artifact's real bytes. Reads each object rather than trusting any
 * cached hash, so the manifest can never disagree with what a pinned URL
 * serves.
 */
async function projectManifestFromStore(store: CdnObjectStore): Promise<CdnManifest> {
  const keys = await store.list();
  const entries = [];
  for (const key of keys) {
    const version = parseVersionedName(key);
    if (version === null) continue;
    const bytes = await store.get(key);
    if (bytes === null) {
      throw new Error(`${key} was listed but could not be read`);
    }
    entries.push({ version, integrity: integrityHash(bytes) });
  }
  return projectSriManifest(entries);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
