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
 * Pure by design: no filesystem access lives here so the planning logic is
 * unit-testable. The `./vite-plugin-cdn-artifacts.ts` plugin wires it to disk
 * after the IIFE build.
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

interface ArtifactEntry {
  path: string;
  integrity: string;
}

export interface CdnManifest {
  version: string;
  algorithm: SriAlgorithm;
  artifacts: {
    /** The floating path — opt-in "latest", not integrity-pinnable. */
    latest: ArtifactEntry;
    /** The immutable pinned path embedders should install. */
    pinned: ArtifactEntry;
  };
}

export interface CdnArtifactPlan {
  /** filename → contents to write into the dist/CDN directory. */
  files: Record<string, string>;
  manifest: CdnManifest;
}

export interface PlanCdnArtifactsInput {
  version: string;
  /** The built IIFE (contents of dist/flame.js). */
  iife: string;
}

/**
 * Given the built IIFE and a version, plan the extra CDN artifacts:
 * the immutable pinned copy and the SRI manifest. Pure — returns the files
 * to write rather than touching disk. The floating `flame.js` is left as the
 * bundler wrote it; the manifest records its hash so consumers can pin either
 * path. Both paths carry identical bytes, hence one shared integrity value.
 */
export function planCdnArtifacts({ version, iife }: PlanCdnArtifactsInput): CdnArtifactPlan {
  const pinnedPath = versionedName(version);
  const integrity = integrityHash(iife);

  const manifest: CdnManifest = {
    version,
    algorithm: 'sha384',
    artifacts: {
      latest: { path: LATEST_NAME, integrity },
      pinned: { path: pinnedPath, integrity },
    },
  };

  return {
    files: {
      [pinnedPath]: iife,
      [MANIFEST_NAME]: `${JSON.stringify(manifest, null, 2)}\n`,
    },
    manifest,
  };
}
