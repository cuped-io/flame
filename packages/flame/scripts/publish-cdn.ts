import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LATEST_NAME } from './cdn-artifacts';
import { publishCdnRelease } from './cdn-publish';
import { r2StoreFromEnv } from './r2-store';

/**
 * Release-workflow entrypoint: publish the just-released version's CDN
 * artifacts into the write-once R2 bucket. Runs from release.yml only when
 * changesets actually published @cuped-io/flame (ADR-0022) — by then
 * `pnpm release` has rebuilt dist/ at the released version, so
 * package.json's version and dist/flame.js describe the released bytes.
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */

const packageRoot = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(
  readFileSync(resolve(packageRoot, 'package.json'), 'utf8'),
) as { version: string };
const iife = readFileSync(resolve(packageRoot, 'dist', LATEST_NAME));

const result = await publishCdnRelease({ store: r2StoreFromEnv(), version, iife });

console.log(`flame@${version}.js: ${result.pinned}`);
console.log(
  result.floatingUpdated
    ? `${LATEST_NAME}: updated to ${version}`
    : `${LATEST_NAME}: left at ${result.manifest.latest} (newer than ${version})`,
);
console.log(`flame.sri.json: ${Object.keys(result.manifest.versions).length} version(s), latest ${result.manifest.latest}`);
