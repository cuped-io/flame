/**
 * Client-side deterministic bucketing — a faithful port of ember's
 * server-side sticky bucketing (`crates/ember-core/src/domain/services/sdk.rs`).
 *
 * ⚠️ This MUST produce bit-identical assignments to the server. If the client
 * and server ever disagree, a visitor sees variant A while the server
 * attributes B — silently corrupting experiment data, the one thing an A/B
 * product must get right. The port is pinned to ember's golden vectors and
 * its contract fixture (`bucketing.test.ts`,
 * `contracts/sticky-bucket-vectors.contract.json`); the algorithm is a FROZEN
 * SHARED CONTRACT with ember (flame#24, ember#309) — if either side changes
 * it, both golden-vector suites move in lockstep.
 *
 * Algorithm:
 *   1. `stickyBucket(user, exp, n)` = `SHA256("{user}:{exp}")[0..8]` as a
 *      big-endian u64, modulo `n`. `exp` is lowercased, as ember's `Uuid`
 *      formats it.
 *   2. `select`: sort variants by lowercase id ascending; `total = Σ max(0, weight)`;
 *      `bucket = stickyBucket(user, exp, total)`; walk sorted variants
 *      accumulating weight and return the first whose cumulative range
 *      `[prev, prev+weight)` contains the bucket.
 */

export interface WeightedVariant {
  id: string;
  weight: number;
}

/**
 * `SHA256("{userId}:{experimentId}")`, first 8 bytes as a big-endian u64,
 * modulo `numBuckets`. Mirrors ember's `sticky_bucket` exactly. The id is
 * lowercased: ember hashes its `Uuid`'s lowercase form, whatever casing it
 * was given.
 */
export async function stickyBucket(
  userId: string,
  experimentId: string,
  numBuckets: number
): Promise<number> {
  const input = new TextEncoder().encode(`${userId}:${experimentId.toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  // First 8 bytes, big-endian (matches Rust `u64::from_be_bytes(digest[..8])`).
  const hash = new DataView(digest.buffer, digest.byteOffset, 8).getBigUint64(0, false);
  return Number(hash % BigInt(numBuckets));
}

/**
 * Deterministically select a variant for a user via the weighted-CDF walk.
 * Returns `null` when the total weight is 0 (nothing selectable). Mirrors
 * ember's `select_variant_deterministically`.
 */
export async function selectVariantDeterministically<T extends WeightedVariant>(
  userId: string,
  experimentId: string,
  variants: readonly T[]
): Promise<T | null> {
  // Sort by id ascending — lowercase UUID string order equals ember's `Uuid`
  // byte order, so this matches the server's `sort_by_id` step (which the CDF
  // walk depends on: the cumulative segments are assigned in this order). Raw
  // mixed-case order would not: 'B' (0x42) sorts before 'a' (0x61).
  const sorted = variants
    .map((v) => ({ key: v.id.toLowerCase(), v }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ v }) => v);

  const totalWeight = sorted.reduce((sum, v) => sum + Math.max(0, v.weight), 0);
  if (totalWeight === 0) return null;

  const bucket = await stickyBucket(userId, experimentId, totalWeight);
  let cumulative = 0;
  for (const v of sorted) {
    cumulative += Math.max(0, v.weight);
    if (bucket < cumulative) return v;
  }
  return null;
}
