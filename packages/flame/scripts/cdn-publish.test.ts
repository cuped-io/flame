import { describe, expect, it } from 'vitest';
import { integrityHash } from './cdn-artifacts';
import { publishCdnRelease, type CdnObjectStore } from './cdn-publish';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * In-memory CdnObjectStore with the same conditional-write semantics R2
 * enforces (`If-None-Match: *` → conflict on an existing key).
 */
function memoryStore(initial: Record<string, string> = {}) {
  const objects = new Map<string, Uint8Array>(
    Object.entries(initial).map(([key, body]) => [key, encoder.encode(body)]),
  );
  const store: CdnObjectStore = {
    async putIfAbsent(key, body) {
      if (objects.has(key)) return 'conflict';
      objects.set(key, body);
      return 'created';
    },
    async put(key, body) {
      objects.set(key, body);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async list() {
      return [...objects.keys()];
    },
  };
  const text = (key: string) => {
    const bytes = objects.get(key);
    return bytes === undefined ? null : decoder.decode(bytes);
  };
  return { store, text };
}

const iife = (marker: string) => encoder.encode(`window.flame=${JSON.stringify(marker)};`);

describe('publishCdnRelease', () => {
  it('publishes pin + floating + manifest into an empty bucket', async () => {
    const { store, text } = memoryStore();

    const result = await publishCdnRelease({ store, version: '0.4.0', iife: iife('0.4.0') });

    expect(result.pinned).toBe('created');
    expect(result.floatingUpdated).toBe(true);
    expect(text('flame@0.4.0.js')).toBe('window.flame="0.4.0";');
    expect(text('flame.js')).toBe('window.flame="0.4.0";');
    expect(JSON.parse(text('flame.sri.json')!)).toEqual({
      algorithm: 'sha384',
      latest: '0.4.0',
      versions: {
        '0.4.0': { path: 'flame@0.4.0.js', integrity: integrityHash(iife('0.4.0')) },
      },
    });
  });

  it('keeps older pins and grows the manifest on the next release', async () => {
    const { store, text } = memoryStore();
    await publishCdnRelease({ store, version: '0.4.0', iife: iife('0.4.0') });

    await publishCdnRelease({ store, version: '0.5.0', iife: iife('0.5.0') });

    // The core promise of #25: the old pin still resolves, byte-for-byte.
    expect(text('flame@0.4.0.js')).toBe('window.flame="0.4.0";');
    expect(text('flame.js')).toBe('window.flame="0.5.0";');
    const manifest = JSON.parse(text('flame.sri.json')!);
    expect(manifest.latest).toBe('0.5.0');
    expect(Object.keys(manifest.versions)).toEqual(['0.4.0', '0.5.0']);
    expect(manifest.versions['0.4.0'].integrity).toBe(integrityHash(iife('0.4.0')));
  });

  it('is an idempotent no-op when re-run with identical bytes', async () => {
    const { store, text } = memoryStore();
    await publishCdnRelease({ store, version: '0.4.0', iife: iife('0.4.0') });

    const rerun = await publishCdnRelease({ store, version: '0.4.0', iife: iife('0.4.0') });

    expect(rerun.pinned).toBe('unchanged');
    expect(text('flame@0.4.0.js')).toBe('window.flame="0.4.0";');
  });

  it('hard-fails on differing bytes for an already-published version', async () => {
    const { store, text } = memoryStore();
    await publishCdnRelease({ store, version: '0.4.0', iife: iife('0.4.0') });

    await expect(
      publishCdnRelease({ store, version: '0.4.0', iife: iife('tampered') }),
    ).rejects.toThrow(/write-once/);
    expect(text('flame@0.4.0.js')).toBe('window.flame="0.4.0";');
  });

  it('does not move the floating flame.js backwards on an older-version re-run', async () => {
    const { store, text } = memoryStore();
    await publishCdnRelease({ store, version: '0.4.0', iife: iife('0.4.0') });
    await publishCdnRelease({ store, version: '0.5.0', iife: iife('0.5.0') });

    const rerun = await publishCdnRelease({ store, version: '0.4.0', iife: iife('0.4.0') });

    // ADR-0022: floating = latest released, so a 0.4.0 re-run after 0.5.0
    // shipped must leave flame.js on 0.5.0's bytes.
    expect(rerun.floatingUpdated).toBe(false);
    expect(text('flame.js')).toBe('window.flame="0.5.0";');
  });

  it('does not move the floating flame.js to a prerelease', async () => {
    const { store, text } = memoryStore();
    await publishCdnRelease({ store, version: '0.5.0', iife: iife('0.5.0') });

    const pre = await publishCdnRelease({ store, version: '1.0.0-beta.1', iife: iife('beta') });

    // The prerelease pin is published and listed, but latest (and the
    // floating path) stay on the newest stable release.
    expect(pre.floatingUpdated).toBe(false);
    expect(text('flame.js')).toBe('window.flame="0.5.0";');
    const manifest = JSON.parse(text('flame.sri.json')!);
    expect(manifest.latest).toBe('0.5.0');
    expect(Object.keys(manifest.versions)).toEqual(['0.5.0', '1.0.0-beta.1']);
  });

  it('ignores malformed keys in the bucket when projecting the manifest', async () => {
    // A hand-placed junk key must not poison ordering or the projection.
    const { store, text } = memoryStore({
      'flame@v0.3.0.js': 'window.flame="typo";',
      'some-note.txt': 'not an artifact',
    });
    await publishCdnRelease({ store, version: '0.4.0', iife: iife('0.4.0') });

    const manifest = JSON.parse(text('flame.sri.json')!);
    expect(Object.keys(manifest.versions)).toEqual(['0.4.0']);
    expect(manifest.latest).toBe('0.4.0');
  });

  it('projects the manifest from the bucket, self-healing a stale manifest', async () => {
    // Simulate the aftermath of a dropped release: 0.5.0's pin landed but
    // the manifest write never happened. The next publish must repair it
    // purely from bucket contents (ADR-0021: projection, not append).
    const { store, text } = memoryStore({
      'flame@0.4.0.js': 'window.flame="0.4.0";',
      'flame@0.5.0.js': 'window.flame="0.5.0";',
      'flame.js': 'window.flame="0.5.0";',
      'flame.sri.json': '{"stale":true}',
    });

    await publishCdnRelease({ store, version: '0.6.0', iife: iife('0.6.0') });

    const manifest = JSON.parse(text('flame.sri.json')!);
    expect(Object.keys(manifest.versions)).toEqual(['0.4.0', '0.5.0', '0.6.0']);
    expect(manifest.latest).toBe('0.6.0');
  });
});
