import { describe, expect, it } from 'vitest';
import {
  installSnippet,
  integrityHash,
  planCdnArtifacts,
  versionedName,
} from './cdn-artifacts';

describe('integrityHash', () => {
  it('produces an sha384 Subresource Integrity string by default', () => {
    // Golden vector: `sha384-` + base64(sha384("hello")).
    expect(integrityHash('hello')).toBe(
      'sha384-WeF0h3dEjGnea4ANejO7+5/xtGPkQ1TDVTvNucZm+pASWjx5+QOXvfX2oT3oKGhP',
    );
  });
});

describe('versionedName', () => {
  it('builds the immutable pinned filename from a semver', () => {
    expect(versionedName('0.4.0')).toBe('flame@0.4.0.js');
  });

  it('rejects a version that would break out of the filename', () => {
    // A `/`, whitespace or empty version could escape the CDN path or
    // silently mint a non-immutable artifact — refuse it loudly.
    expect(() => versionedName('')).toThrow();
    expect(() => versionedName('1.0.0/../evil')).toThrow();
    expect(() => versionedName('1.0 .0')).toThrow();
  });
});

describe('installSnippet', () => {
  it('emits a pinned script tag guarded by SRI', () => {
    const snippet = installSnippet({
      src: 'https://cdn.cuped.io/flame@0.4.0.js',
      integrity: 'sha384-abc',
      dsn: 'https://YOUR_KEY@api.cuped.io',
    });

    expect(snippet).toContain('src="https://cdn.cuped.io/flame@0.4.0.js"');
    expect(snippet).toContain('integrity="sha384-abc"');
    // SRI on a cross-origin script requires the crossorigin attribute, or the
    // browser refuses to expose the response for hashing and blocks the load.
    expect(snippet).toContain('crossorigin="anonymous"');
    expect(snippet).toContain('data-dsn="https://YOUR_KEY@api.cuped.io"');
  });

  it('omits the data-dsn attribute when no dsn is given', () => {
    const snippet = installSnippet({
      src: 'https://cdn.cuped.io/flame@0.4.0.js',
      integrity: 'sha384-abc',
    });

    expect(snippet).not.toContain('data-dsn');
  });
});

describe('planCdnArtifacts', () => {
  const iife = 'window.flame=1;';
  const plan = planCdnArtifacts({ version: '0.4.0', iife });

  it('emits the pinned artifact carrying the IIFE bytes verbatim', () => {
    expect(plan.files['flame@0.4.0.js']).toBe(iife);
  });

  it('does not re-emit the floating flame.js the bundler already wrote', () => {
    // vite writes dist/flame.js; the plan only adds the new sidecar files.
    expect(plan.files).not.toHaveProperty('flame.js');
  });

  it('writes an SRI manifest describing both the latest and pinned paths', () => {
    const sri = integrityHash(iife);
    expect(plan.manifest).toEqual({
      version: '0.4.0',
      algorithm: 'sha384',
      artifacts: {
        latest: { path: 'flame.js', integrity: sri },
        pinned: { path: 'flame@0.4.0.js', integrity: sri },
      },
    });
  });

  it('serialises the manifest to flame.sri.json', () => {
    expect(JSON.parse(plan.files['flame.sri.json'])).toEqual(plan.manifest);
  });
});
