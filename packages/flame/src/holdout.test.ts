import { describe, it, expect } from 'vitest';
import { holdoutBucket, isHeldOut } from './holdout';
import contract from './contracts/holdout-bucket-vectors.contract.json';

// Expected buckets are ported VERBATIM from ember's `holdout_bucket_golden_vectors`
// (crates/ember-core/src/domain/services/holdout_admission.rs).
// `contracts/holdout-bucket-vectors.contract.json` is a byte-identical copy of
// ember's `crates/ember-core/tests/contracts/holdout_bucket_vectors.json`
// (ember#309), which ember checks in `draw_arm_matches_the_flame_contract_vectors`.
// If a value here differs from ember's, a new visitor's Holdout arm drifts.
const HOLDOUT_A = '550e8400-e29b-41d4-a716-446655440000';
const HOLDOUT_B = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('the Holdout draw is bit-identical to ember', () => {
  it.each([
    ['user_1', HOLDOUT_A, 2921],
    ['user_2', HOLDOUT_A, 5700],
    // A new Holdout id gives an independent draw.
    ['user_1', HOLDOUT_B, 836],
    ['', HOLDOUT_A, 6137],
    ['d_abc123', HOLDOUT_B, 2540],
  ])('holdoutBucket(%j, %s) matches ember golden vector %i', async (userId, holdoutId, bucket) => {
    expect(await holdoutBucket(userId, holdoutId)).toBe(bucket);
  });

  it.each(contract.vectors)(
    "matches ember's contract vector for $user_id at $percentage%",
    async (vector) => {
      expect(await holdoutBucket(vector.user_id, vector.holdout_id)).toBe(vector.bucket);
      expect(await isHeldOut(vector.user_id, vector.holdout_id, vector.percentage)).toBe(
        vector.held_out
      );
    }
  );

  it('treats a mixed-case Holdout id as the lowercase one ember hashes', async () => {
    expect(await holdoutBucket('user_1', HOLDOUT_B.toUpperCase())).toBe(836);
  });
});
