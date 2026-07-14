import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cdnArtifactsPlugin } from './vite-plugin-cdn-artifacts';

describe('cdnArtifactsPlugin writeBundle', () => {
  let outDir: string;
  const iife = 'window.flame="build-output";\n';

  beforeEach(() => {
    outDir = mkdtempSync(resolve(tmpdir(), 'flame-cdn-'));
    // Stand in for what vite writes: dist/flame.js.
    writeFileSync(resolve(outDir, 'flame.js'), iife);
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('writes a pinned copy byte-identical to the emitted flame.js', () => {
    cdnArtifactsPlugin('1.2.3').writeBundle({ dir: outDir });

    const latest = readFileSync(resolve(outDir, 'flame.js'));
    const pinned = readFileSync(resolve(outDir, 'flame@1.2.3.js'));
    expect(pinned.equals(latest)).toBe(true);
  });

  it('does not write an SRI manifest at build time', () => {
    cdnArtifactsPlugin('1.2.3').writeBundle({ dir: outDir });

    // The manifest is a publish-time projection of the R2 bucket
    // (ADR-0021); a build-time one would only ever know its own version.
    expect(existsSync(resolve(outDir, 'flame.sri.json'))).toBe(false);
  });
});
