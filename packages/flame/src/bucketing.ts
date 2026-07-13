/**
 * Client-side deterministic bucketing — a faithful port of ember's
 * server-side sticky bucketing (`crates/ember-core/src/domain/services/sdk.rs`).
 *
 * ⚠️ This MUST produce bit-identical assignments to the server. If the client
 * and server ever disagree, a visitor sees variant A while the server
 * attributes B — silently corrupting experiment data, the one thing an A/B
 * product must get right. The port is pinned to ember's golden vectors
 * (`bucketing.test.ts`); the algorithm is a FROZEN SHARED CONTRACT (flame#24)
 * — if either side changes it, both golden-vector suites move in lockstep.
 *
 * Algorithm:
 *   1. `stickyBucket(user, exp, n)` = `SHA256("{user}:{exp}")[0..8]` as a
 *      big-endian u64, modulo `n`.
 *   2. `select`: sort variants by id ascending; `total = Σ max(0, weight)`;
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
 * modulo `numBuckets`. Mirrors ember's `sticky_bucket` exactly.
 */
export async function stickyBucket(
  userId: string,
  experimentId: string,
  numBuckets: number
): Promise<number> {
  const input = new TextEncoder().encode(`${userId}:${experimentId}`);
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
  // Sort by id ascending — UUID string order equals ember's `Uuid` byte order,
  // so this matches the server's `sort_by_id` step (which the CDF walk depends
  // on: the cumulative segments are assigned in this order).
  const sorted = [...variants].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
