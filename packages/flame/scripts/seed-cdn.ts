import { readFileSync } from 'node:fs';
import { publishCdnRelease } from './cdn-publish';
import { r2StoreFromEnv } from './r2-store';

/**
 * One-time seeding of an already-published artifact into the R2 bucket,
 * used for the Pages → R2 cutover (flame#25): the live 0.4.0 bytes must be
 * in the bucket before cdn.cuped.io repoints, so existing pins (URL + SRI)
 * keep resolving. Run while the old host still serves the artifact:
 *
 *   pnpm --filter @cuped-io/flame seed-cdn 0.4.0 https://cdn.cuped.io/flame@0.4.0.js
 *
 * The source may be an https:// URL or a local file path. Seeding goes
 * through the same write-once publish flow as a release, so re-running is
 * an idempotent no-op and differing bytes fail loudly. See infra's
 * RUNBOOK_CDN_CUTOVER.md for the full cutover sequence.
 *
 * Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */

const [version, source] = process.argv.slice(2);
if (!version || !source) {
  console.error('Usage: seed-cdn <version> <url-or-file>');
  process.exit(1);
}

let iife: Uint8Array;
if (/^https?:\/\//.test(source)) {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${source}: ${response.status} ${response.statusText}`);
  }
  iife = new Uint8Array(await response.arrayBuffer());
} else {
  iife = readFileSync(source);
}

const result = await publishCdnRelease({ store: r2StoreFromEnv(), version, iife });

console.log(`flame@${version}.js: ${result.pinned}`);
console.log(`flame.js ${result.floatingUpdated ? 'updated' : 'unchanged'}; manifest latest ${result.manifest.latest}`);
