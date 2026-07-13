import { describe, it, expect } from 'vitest';
import { stickyBucket, selectVariantDeterministically, type WeightedVariant } from './bucketing';

// UUIDs + expected outputs are ported VERBATIM from ember's golden-vector
// tests in crates/ember-core/src/domain/services/sdk.rs
// (`sticky_bucket_golden_vectors`, `select_variant_weighted_cdf_golden_vectors`).
// These values ARE the shared client/server bucketing contract (flame#24): if
// any value here ever differs from ember's, the two implementations have
// drifted and experiment assignments would corrupt. This test is the guard —
// it fails on any divergence.
const EXP1 = '550e8400-e29b-41d4-a716-446655440001';
const EXP2 = '00000000-0000-0000-0000-000000000000';
const CONTROL = '11111111-1111-1111-1111-111111111111';
const TREATMENT = '22222222-2222-2222-2222-222222222222';

describe('client bucketing is bit-identical to ember (flame#24 golden vectors)', () => {
  it('stickyBucket matches ember sticky_bucket_golden_vectors', async () => {
    // sha256("user-1:550e8400-…")[0..8] = 0x9acfcc1c05a9464a → % 2 = 0
    expect(await stickyBucket('user-1', EXP1, 2)).toBe(0);
    // sha256("user-2:550e8400-…") → % 3 = 1
    expect(await stickyBucket('user-2', EXP1, 3)).toBe(1);
    // sha256("alice@example.com:00000000-…") → % 4 = 0
    expect(await stickyBucket('alice@example.com', EXP2, 4)).toBe(0);
    // sha256(":550e8400-…") → % 5 = 0  (empty user id)
    expect(await stickyBucket('', EXP1, 5)).toBe(0);
  });

  it('selectVariantDeterministically matches ember weighted-CDF golden vectors', async () => {
    // Case A — WEIGHTED [control w=1, treatment w=3], passed in REVERSE id order.
    // total_weight=4, user-1's hash%4=2 lands in treatment's segment [1,4) → treatment.
    const weighted: WeightedVariant[] = [
      { id: TREATMENT, weight: 3 },
      { id: CONTROL, weight: 1 },
    ];
    expect((await selectVariantDeterministically('user-1', EXP1, weighted))?.id).toBe(TREATMENT);

    // Case B — EQUAL-WEIGHT [w=1, w=1], reversed. total=2, hash%2=0 → sorted_asc[0]=control.
    // (Reversed input catches a no-sort/sort-desc bug — it would return treatment.)
    const equal: WeightedVariant[] = [
      { id: TREATMENT, weight: 1 },
      { id: CONTROL, weight: 1 },
    ];
    expect((await selectVariantDeterministically('user-1', EXP1, equal))?.id).toBe(CONTROL);
  });

  it('returns null when total weight is 0 (nothing selectable)', async () => {
    const zero: WeightedVariant[] = [
      { id: CONTROL, weight: 0 },
      { id: TREATMENT, weight: 0 },
    ];
    expect(await selectVariantDeterministically('user-1', EXP1, zero)).toBeNull();
  });
});
