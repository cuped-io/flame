/**
 * Client-side Holdout draw — a faithful port of ember's first-sight draw
 * (`draw_arm` in `crates/ember-core/src/domain/services/holdout_admission.rs`).
 *
 * ⚠️ This MUST agree bit-for-bit with the server. A visitor the client draws
 * into the Holdout but the server counts as exposed (or the reverse) corrupts
 * the Holdout report. The port is pinned to ember's golden vectors and its
 * contract fixture (`holdout.test.ts`,
 * `contracts/holdout-bucket-vectors.contract.json`); the algorithm is a FROZEN
 * SHARED CONTRACT with ember (flame#24, ember#309) — if either side changes
 * it, both golden-vector suites move in lockstep.
 *
 * Algorithm:
 *   1. `holdoutBucket(user, holdout)` = `SHA256("{user}:{holdout}")[0..8]` as
 *      a big-endian u64, modulo 10,000 (basis points). `holdout` is
 *      lowercased, as ember's `Uuid` formats it.
 *   2. Held out when the bucket is below `round(percentage * 100)`: a 5%
 *      Holdout holds out buckets 0..499.
 *
 * Only for a visitor with no stored Holdout arm: a stored arm always wins.
 */

import { stickyBucket } from './bucketing';

/** Basis points, so a percentage is honoured to two decimals. */
const HOLDOUT_BUCKETS = 10_000;

/**
 * Basis-point bucket for `(userId, holdoutId)`. Mirrors ember's
 * `holdout_bucket`, which is ember's `sticky_bucket` hash over 10,000 buckets.
 */
export function holdoutBucket(userId: string, holdoutId: string): Promise<number> {
  return stickyBucket(userId, holdoutId, HOLDOUT_BUCKETS);
}

/**
 * Whether a new visitor is drawn into the Holdout at `percentage` (0 to 100).
 * Mirrors ember's `draw_arm`. ember clamps the threshold to [0, 10000] before
 * comparing; every bucket is in that range, so comparing unclamped is the same.
 * `Math.round` and Rust's `f64::round` differ only on negative halves, which
 * hold out no one either way.
 */
export async function isHeldOut(
  userId: string,
  holdoutId: string,
  percentage: number
): Promise<boolean> {
  return (await holdoutBucket(userId, holdoutId)) < Math.round(percentage * 100);
}
