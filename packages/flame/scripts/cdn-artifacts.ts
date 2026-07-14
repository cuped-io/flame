import { createHash } from 'node:crypto';

/**
 * CDN artifact tooling for the script-tag build.
 *
 * The IIFE is served from `cdn.cuped.io`. Historically it was published
 * only as the floating `flame.js`, so a bad deploy reached every embedder
 * instantly with no pinned version to roll back to and no way to guard the
 * `<script>` tag with Subresource Integrity. This module produces, from a
 * single built IIFE, the immutable versioned artifact and the SRI hashes
 * that make a pinned, verifiable install snippet possible.
 *
 * The SRI manifest is a projection of the R2 bucket's contents (every
 * `flame@X.Y.Z.js` present), never an accumulator — see ember ADR-0021.
 * It is therefore built at publish time (`./cdn-publish.ts`), not at build
 * time; the build only plans the pinned copy of the IIFE.
 *
 * Pure by design: no filesystem or network access lives here so the
 * planning logic is unit-testable. The `./vite-plugin-cdn-artifacts.ts`
 * plugin wires build-time planning to disk; `./cdn-publish.ts` wires the
 * manifest projection to the bucket.
 */

export type SriAlgorithm = 'sha256' | 'sha384' | 'sha512';

/**
 * Compute a Subresource Integrity string for `content`, e.g.
 * `sha384-<base64>`. Defaults to sha384 — the algorithm the SRI spec
 * recommends and what we publish in the install snippet.
 */
export function integrityHash(
  content: string | Uint8Array,
  algorithm: SriAlgorithm = 'sha384',
): string {
  const digest = createHash(algorithm).update(content).digest('base64');
  return `${algorithm}-${digest}`;
}

// A version is only allowed to contain the characters npm/semver actually
// uses. This keeps the value from escaping the CDN path (`../`) or minting a
// filename that isn't a stable, immutable pin.
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;

/**
 * The immutable, pinned filename for a given package version, e.g.
 * `flame@0.4.0.js`. This is the path embedders pin to; unlike floating
 * `flame.js` it never changes content once published, so a bad deploy can
 * be rolled back by pointing at the previous pin.
 */
export function versionedName(version: string): string {
  if (!SAFE_VERSION.test(version)) {
    throw new Error(`Unsafe version for CDN filename: ${JSON.stringify(version)}`);
  }
  return `flame@${version}.js`;
}

export interface InstallSnippetOptions {
  /** Fully-qualified CDN URL of the script, e.g. a pinned `flame@X.Y.Z.js`. */
  src: string;
  /** SRI hash to guard the load with, e.g. `sha384-...`. */
  integrity: string;
  /** Optional DSN to inline as `data-dsn`; omitted when absent. */
  dsn?: string;
}

/**
 * Render the `<script>` install snippet for the script-tag flow with SRI
 * enabled. `crossorigin="anonymous"` is mandatory: the browser only exposes a
 * cross-origin response for integrity checking under a CORS request, and
 * without it the pinned+hashed script is blocked outright.
 */
export function installSnippet({ src, integrity, dsn }: InstallSnippetOptions): string {
  const attrs = [
    `  src="${src}"`,
    `  integrity="${integrity}"`,
    `  crossorigin="anonymous"`,
  ];
  if (dsn) {
    attrs.push(`  data-dsn="${dsn}"`);
  }
  return `<script\n${attrs.join('\n')}\n></script>`;
}

/** The floating "latest" filename served at `cdn.cuped.io/flame.js`. */
export const LATEST_NAME = 'flame.js';
/** Filename of the SRI manifest published alongside the artifacts. */
export const MANIFEST_NAME = 'flame.sri.json';

/**
 * Recover the version from a pinned filename, e.g. `flame@0.4.0.js` →
 * `0.4.0`. Returns null for keys that are not pinned artifacts (the
 * floating `flame.js`, the manifest, anything else in the bucket), so a
 * bucket listing can be filtered with it directly.
 */
export function parseVersionedName(key: string): string | null {
  const match = /^flame@(.+)\.js$/.exec(key);
  if (!match || !SAFE_VERSION.test(match[1])) {
    return null;
  }
  return match[1];
}

interface ArtifactEntry {
  path: string;
  integrity: string;
}

/**
 * The published `flame.sri.json`: one entry per still-supported version
 * (policy: every version, forever), plus which of them is the newest
 * release — the version whose bytes the floating `flame.js` serves.
 */
export interface CdnManifest {
  algorithm: SriAlgorithm;
  /** The newest released version; `versions[latest]` describes it. */
  latest: string;
  /** version → its immutable pinned artifact. */
  versions: Record<string, ArtifactEntry>;
}

export interface CdnArtifactPlan {
  /** filename → contents to write into the dist/CDN directory. */
  files: Record<string, string>;
}

export interface PlanCdnArtifactsInput {
  version: string;
  /** The built IIFE (contents of dist/flame.js). */
  iife: string;
}

/**
 * Given the built IIFE and a version, plan the build-time CDN sidecar: the
 * immutable pinned copy. Pure — returns the files to write rather than
 * touching disk. The floating `flame.js` is left as the bundler wrote it.
 * The SRI manifest is deliberately NOT planned here: it is a projection of
 * the bucket's published versions, built by `cdn-publish.ts` at release
 * time (ADR-0021 — a build knows only its own version).
 */
export function planCdnArtifacts({ version, iife }: PlanCdnArtifactsInput): CdnArtifactPlan {
  return {
    files: {
      [versionedName(version)]: iife,
    },
  };
}

// Semver-ish comparator, sufficient for changesets output: dotted numeric
// core, optional prerelease after `-` (a prerelease sorts before its
// release; prerelease identifiers compare per semver §11). Build metadata
// (`+...`) is not stripped — changesets never emits it, and two versions
// differing only in build metadata would collide as filenames anyway.
export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = splitPrerelease(a);
  const [coreB, preB] = splitPrerelease(b);
  const numsA = coreA.split('.').map(Number);
  const numsB = coreB.split('.').map(Number);
  for (let i = 0; i < Math.max(numsA.length, numsB.length); i += 1) {
    const diff = (numsA[i] ?? 0) - (numsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (preA === undefined || preB === undefined) {
    // A prerelease precedes the release it precedes.
    return (preA === undefined ? 1 : 0) - (preB === undefined ? 1 : 0);
  }
  const idsA = preA.split('.');
  const idsB = preB.split('.');
  for (let i = 0; i < Math.max(idsA.length, idsB.length); i += 1) {
    const idA = idsA[i];
    const idB = idsB[i];
    if (idA === idB) continue;
    // A shorter prerelease is smaller once the shared prefix ties.
    if (idA === undefined) return -1;
    if (idB === undefined) return 1;
    const numericA = /^\d+$/.test(idA);
    const numericB = /^\d+$/.test(idB);
    if (numericA && numericB) return Number(idA) - Number(idB);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return idA < idB ? -1 : 1;
  }
  return 0;
}

function splitPrerelease(version: string): [string, string?] {
  const dash = version.indexOf('-');
  return dash === -1 ? [version] : [version.slice(0, dash), version.slice(dash + 1)];
}

export interface ManifestEntryInput {
  version: string;
  integrity: string;
}

/**
 * Project the SRI manifest from the bucket's published versions. Pure: the
 * manifest is a function of what is actually resolvable, never an append
 * onto the previous manifest, so it can't drift from the bucket and
 * self-heals after a dropped release (ADR-0021). `latest` is the semver-max
 * of the published versions — releases are monotonic, so this is the
 * newest release.
 */
export function projectSriManifest(entries: ManifestEntryInput[]): CdnManifest {
  if (entries.length === 0) {
    throw new Error('Cannot project an SRI manifest from an empty version set');
  }
  const sorted = [...entries].sort((a, b) => compareVersions(a.version, b.version));
  const versions: Record<string, ArtifactEntry> = {};
  for (const { version, integrity } of sorted) {
    if (versions[version]) {
      throw new Error(`Duplicate version in manifest projection: ${version}`);
    }
    versions[version] = { path: versionedName(version), integrity };
  }
  return {
    algorithm: 'sha384',
    latest: sorted[sorted.length - 1].version,
    versions,
  };
}

/** Serialise a manifest exactly as it is published at `flame.sri.json`. */
export function serialiseManifest(manifest: CdnManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
