import { describe, it, expect } from 'vitest';
import { stickyBucket, selectVariantDeterministically, type WeightedVariant } from './bucketing';
import contract from './contracts/sticky-bucket-vectors.contract.json';

// UUIDs + expected outputs are ported VERBATIM from ember's golden-vector
// tests in crates/ember-core/src/domain/services/sdk.rs
// (`sticky_bucket_golden_vectors`, `select_variant_weighted_cdf_golden_vectors`).
// `contracts/sticky-bucket-vectors.contract.json` is a byte-identical copy of
// ember's `crates/ember-core/tests/contracts/sticky_bucket_vectors.json`
// (ember#309), which ember checks in `select_variant_matches_the_flame_contract_vectors`.
// These values ARE the shared client/server bucketing contract (flame#24): if
// any value here ever differs from ember's, the two implementations have
// drifted and experiment assignments would corrupt. This test is the guard —
// it fails on any divergence.
const EXP1 = '550e8400-e29b-41d4-a716-446655440001';
const EXP2 = '00000000-0000-0000-0000-000000000000';
const CONTROL = '11111111-1111-1111-1111-111111111111';
const TREATMENT = '22222222-2222-2222-2222-222222222222';
const TREATMENT_B = '33333333-3333-3333-3333-333333333333';

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

    // Case C — WEIGHTED [2, 2, 1], reversed. total=5, user-2's hash%5=4 lands in
    // treatment_b's segment [4,5). The uniform walk would pick treatment.
    const weighted221: WeightedVariant[] = [
      { id: TREATMENT_B, weight: 1 },
      { id: TREATMENT, weight: 2 },
      { id: CONTROL, weight: 2 },
    ];
    expect((await selectVariantDeterministically('user-2', EXP1, weighted221))?.id).toBe(
      TREATMENT_B
    );

    // Case D — WEIGHTED [1, 4], reversed. total=5, alice/exp2's hash%5=4 lands in
    // treatment's segment [1,5). The uniform walk would pick control.
    const weighted14: WeightedVariant[] = [
      { id: TREATMENT, weight: 4 },
      { id: CONTROL, weight: 1 },
    ];
    expect((await selectVariantDeterministically('alice@example.com', EXP2, weighted14))?.id).toBe(
      TREATMENT
    );

    // Case E — a zero-weight variant is never returned. Weights [1, 0, 2], user-2's
    // hash%3=1 sits on the zero-weight variant's empty [1,1) segment; a `<=` in the
    // walk would return it.
    const zeroSkip: WeightedVariant[] = [
      { id: TREATMENT_B, weight: 2 },
      { id: TREATMENT, weight: 0 },
      { id: CONTROL, weight: 1 },
    ];
    expect((await selectVariantDeterministically('user-2', EXP1, zeroSkip))?.id).toBe(TREATMENT_B);
  });

  it.each(contract.vectors)(
    "matches ember's contract vector for $user_id over $total_weight",
    async (vector) => {
      if (vector.bucket !== null) {
        expect(await stickyBucket(vector.user_id, vector.experiment_id, vector.total_weight)).toBe(
          vector.bucket
        );
      }
      const picked = await selectVariantDeterministically(
        vector.user_id,
        vector.experiment_id,
        vector.variants
      );
      expect(picked?.id ?? null).toBe(vector.variant_id);
    }
  );

  it('treats a mixed-case UUID as the lowercase one ember hashes and sorts', async () => {
    // ember parses ids into `Uuid`, so case never reaches its hash or its sort.
    // d_abc123 over 100 buckets is 87 in ember's contract vectors.
    expect(await stickyBucket('d_abc123', EXP1.toUpperCase(), 100)).toBe(87);

    // Raw string order puts 'B' (0x42) before 'a' (0x61); ember's order puts aaaa… first.
    // user-1's hash%2=0 picks the first sorted variant.
    const lower = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const upper = 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB';
    const mixed: WeightedVariant[] = [
      { id: upper, weight: 1 },
      { id: lower, weight: 1 },
    ];
    expect((await selectVariantDeterministically('user-1', EXP1, mixed))?.id).toBe(lower);
  });

  it('returns null when total weight is 0 (nothing selectable)', async () => {
    const zero: WeightedVariant[] = [
      { id: CONTROL, weight: 0 },
      { id: TREATMENT, weight: 0 },
    ];
    expect(await selectVariantDeterministically('user-1', EXP1, zero)).toBeNull();
  });
});
