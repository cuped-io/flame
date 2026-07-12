import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
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

  it('publishes an SRI manifest matching the bytes served on disk', () => {
    cdnArtifactsPlugin('1.2.3').writeBundle({ dir: outDir });

    const served = readFileSync(resolve(outDir, 'flame.js'));
    const expected = 'sha384-' + createHash('sha384').update(served).digest('base64');
    const manifest = JSON.parse(readFileSync(resolve(outDir, 'flame.sri.json'), 'utf8'));

    expect(manifest.version).toBe('1.2.3');
    expect(manifest.artifacts.latest.integrity).toBe(expected);
    expect(manifest.artifacts.pinned.integrity).toBe(expected);
  });
});
