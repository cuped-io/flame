import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  installSnippet,
  integrityHash,
  parseVersionedName,
  planCdnArtifacts,
  projectSriManifest,
  serialiseManifest,
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

  it('rejects non-strict-semver versions that would poison manifest ordering', () => {
    // A `v0.4.0` seed typo would parse as NaN in the semver comparator and
    // scramble the projected `latest` — refuse to mint the key at all.
    expect(() => versionedName('v0.4.0')).toThrow();
    expect(() => versionedName('0.4')).toThrow();
    expect(() => versionedName('constructor')).toThrow();
    expect(() => versionedName('1.0.0+build.5')).toThrow();
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

describe('parseVersionedName', () => {
  it('is the inverse of versionedName', () => {
    expect(parseVersionedName(versionedName('0.4.0'))).toBe('0.4.0');
    expect(parseVersionedName(versionedName('1.0.0-beta.2'))).toBe('1.0.0-beta.2');
  });

  it('rejects non-pinned bucket keys', () => {
    expect(parseVersionedName('flame.js')).toBeNull();
    expect(parseVersionedName('flame.sri.json')).toBeNull();
    expect(parseVersionedName('flame@.js')).toBeNull();
    expect(parseVersionedName('flame@1.0.0/../evil.js')).toBeNull();
  });

  it('rejects malformed or hand-placed version keys', () => {
    // These would otherwise reach the semver comparator (NaN → scrambled
    // sort) or, for 'constructor', trip Object.prototype lookups.
    expect(parseVersionedName('flame@v0.4.0.js')).toBeNull();
    expect(parseVersionedName('flame@constructor.js')).toBeNull();
    expect(parseVersionedName('flame@01.2.3.js')).toBeNull();
  });
});

describe('planCdnArtifacts', () => {
  const iife = 'window.flame=1;';
  const plan = planCdnArtifacts({ version: '0.4.0', iife });

  it('emits the pinned artifact carrying the IIFE bytes verbatim', () => {
    expect(plan.files).toEqual({ 'flame@0.4.0.js': iife });
  });

  it('does not re-emit the floating flame.js the bundler already wrote', () => {
    // vite writes dist/flame.js; the plan only adds the new sidecar file.
    expect(plan.files).not.toHaveProperty('flame.js');
  });

  it('does not plan the SRI manifest — that is a publish-time bucket projection', () => {
    // ADR-0021: a build knows only its own version, so a build-time
    // manifest would regress to single-version and break older pins.
    expect(plan.files).not.toHaveProperty('flame.sri.json');
  });
});

describe('compareVersions', () => {
  it('orders numerically per component, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.4.0', '0.4.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('sorts a prerelease before its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha.1', '1.0.0-beta')).toBeLessThan(0);
  });
});

describe('projectSriManifest', () => {
  it('maps every published version and derives latest by semver', () => {
    const manifest = projectSriManifest([
      { version: '0.10.0', integrity: 'sha384-newest' },
      { version: '0.4.0', integrity: 'sha384-old' },
      { version: '0.9.0', integrity: 'sha384-mid' },
    ]);

    expect(manifest).toEqual({
      algorithm: 'sha384',
      latest: '0.10.0',
      versions: {
        '0.4.0': { path: 'flame@0.4.0.js', integrity: 'sha384-old' },
        '0.9.0': { path: 'flame@0.9.0.js', integrity: 'sha384-mid' },
        '0.10.0': { path: 'flame@0.10.0.js', integrity: 'sha384-newest' },
      },
    });
  });

  it('refuses an empty version set', () => {
    // An empty bucket means nothing was published — projecting a manifest
    // for it would advertise a "latest" that doesn't resolve.
    expect(() => projectSriManifest([])).toThrow();
  });

  it('never elects a prerelease as latest', () => {
    // The floating flame.js follows `latest`; un-pinned production
    // embedders must not be handed beta bytes (npm latest/next split).
    const manifest = projectSriManifest([
      { version: '0.9.0', integrity: 'sha384-stable' },
      { version: '1.0.0-beta.1', integrity: 'sha384-beta' },
    ]);

    expect(manifest.latest).toBe('0.9.0');
    expect(Object.keys(manifest.versions)).toEqual(['0.9.0', '1.0.0-beta.1']);
  });

  it('refuses a version set with no stable release', () => {
    expect(() => projectSriManifest([{ version: '1.0.0-rc.1', integrity: 'sha384-rc' }])).toThrow(
      /stable/,
    );
  });

  it('refuses duplicate versions', () => {
    expect(() =>
      projectSriManifest([
        { version: '0.4.0', integrity: 'sha384-a' },
        { version: '0.4.0', integrity: 'sha384-b' },
      ]),
    ).toThrow(/duplicate/i);
  });

  it('round-trips through the published serialisation', () => {
    const manifest = projectSriManifest([{ version: '0.4.0', integrity: 'sha384-a' }]);
    expect(JSON.parse(serialiseManifest(manifest))).toEqual(manifest);
  });
});
