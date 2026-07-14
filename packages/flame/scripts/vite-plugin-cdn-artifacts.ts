import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LATEST_NAME, planCdnArtifacts } from './cdn-artifacts';

/** The subset of Rollup's `writeBundle` options this plugin reads. */
interface WriteBundleOptions {
  dir?: string;
}

/** Minimal Rollup/Vite plugin shape — kept local so the pure logic stays vite-free. */
export interface CdnArtifactsPlugin {
  name: string;
  writeBundle(options: WriteBundleOptions): void;
}

/**
 * Vite/Rollup plugin that, after the IIFE bundle is written, emits the
 * immutable pinned copy (`flame@X.Y.Z.js`) next to it.
 *
 * It copies the bytes actually written to `dist/flame.js` (re-read from
 * disk, not the in-memory chunk) so the pinned artifact matches the
 * floating file exactly. The SRI manifest is not built here — it is a
 * publish-time projection of the R2 bucket (see ./cdn-publish.ts and
 * ember ADR-0021). The (unit-tested) planning lives in ./cdn-artifacts.ts.
 */
export function cdnArtifactsPlugin(version: string): CdnArtifactsPlugin {
  return {
    name: 'flame-cdn-artifacts',
    writeBundle(options) {
      const outDir = options.dir ?? resolve(process.cwd(), 'dist');
      const iife = readFileSync(resolve(outDir, LATEST_NAME), 'utf8');
      const { files } = planCdnArtifacts({ version, iife });
      for (const [name, contents] of Object.entries(files)) {
        writeFileSync(resolve(outDir, name), contents);
      }
    },
  };
}
