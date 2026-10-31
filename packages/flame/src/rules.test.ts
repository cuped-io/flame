/**
 * Picking arms from the rules file (flame#24, ember#309). Expected arms come
 * from ember's golden vectors (`contracts/*-vectors.contract.json`), so a pick
 * here is the arm ember's record step accepts.
 */
import { describe, it, expect } from 'vitest';
import { pickArms, type RulesFile } from './rules';
import type { StoredAssignment } from './types';

const EXP = '550e8400-e29b-41d4-a716-446655440001';
const CONTROL = '11111111-1111-1111-1111-111111111111';
const TREATMENT = '22222222-2222-2222-2222-222222222222';
const HOLDOUT = '550e8400-e29b-41d4-a716-446655440000';
const PROMOTED = '99999999-9999-9999-9999-999999999999';
const WINNER = '88888888-8888-8888-8888-888888888888';

function rules(overrides: Partial<RulesFile> = {}): RulesFile {
  return {
    version: 1,
    experiments: [
      {
        id: EXP,
        slug: 'hero-cta',
        url_pattern: null,
        variants: [
          { id: CONTROL, name: 'Control', is_control: true, weight: 1 },
          { id: TREATMENT, name: 'Treatment', is_control: false, weight: 3 },
        ],
      },
    ],
    holdout: null,
    promoted: [],
    ...overrides,
  };
}

const promoted = {
  id: PROMOTED,
  slug: 'old-test',
  url_pattern: null,
  winner_promoted_at: '2026-01-01T00:00:00Z',
  winner: { id: WINNER, name: 'Winner', is_control: false, weight: 1 },
};

const saved = (variantId: string, userId = 'user-1'): Record<string, StoredAssignment> => ({
  [EXP]: { experimentId: EXP, variantId, userId, assignedAt: '2026-01-01T00:00:00Z' },
});

describe('pickArms', () => {
  it("gives a new visitor ember's weighted pick", async () => {
    // Golden vector: user-1, weights control 1 / treatment 3 → bucket 2 → treatment.
    const [arm] = await pickArms(rules(), 'user-1', {});
    expect(arm.experimentId).toBe(EXP);
    expect(arm.slug).toBe('hero-cta');
    expect(arm.variant.id).toBe(TREATMENT);
    expect(arm.variant.name).toBe('Treatment');
    expect(arm.exposure).toBe(true);
  });
});

describe('pickArms: the saved arm', () => {
  it('wins over the pick', async () => {
    const [arm] = await pickArms(rules(), 'user-1', saved(CONTROL));
    expect(arm.variant.id).toBe(CONTROL);
    expect(arm.exposure).toBe(true);
  });

  it("is ignored when it is another visitor's", async () => {
    const [arm] = await pickArms(rules(), 'user-1', saved(CONTROL, 'someone-else'));
    expect(arm.variant.id).toBe(TREATMENT);
  });

  it('is ignored when its variant is gone', async () => {
    const [arm] = await pickArms(rules(), 'user-1', saved('deleted-variant'));
    expect(arm.variant.id).toBe(TREATMENT);
  });
});

describe('pickArms: the Holdout', () => {
  // Golden vectors: user_1's bucket for HOLDOUT is 2921, so 100% holds them out and 5% does not.
  const holdout = (percentage: number, active = true) => ({ id: HOLDOUT, percentage, active });

  it('gives a member control, never recorded', async () => {
    const [arm] = await pickArms(rules({ holdout: holdout(100) }), 'user_1', {});
    expect(arm.variant.id).toBe(CONTROL);
    expect(arm.exposure).toBe(false);
  });

  it('lets a visitor outside it be picked', async () => {
    const [arm] = await pickArms(rules({ holdout: holdout(5) }), 'user_1', {});
    expect(arm.exposure).toBe(true);
  });

  it('holds nobody out when inactive', async () => {
    const [arm] = await pickArms(rules({ holdout: holdout(100, false) }), 'user_1', {});
    expect(arm.exposure).toBe(true);
  });

  it('does not draw a visitor who already has a saved arm', async () => {
    const [arm] = await pickArms(
      rules({ holdout: holdout(100) }),
      'user_1',
      saved(TREATMENT, 'user_1')
    );
    expect(arm.variant.id).toBe(TREATMENT);
    expect(arm.exposure).toBe(true);
  });
});

describe('pickArms: promoted winners', () => {
  it('serves the winner, never recorded', async () => {
    const arms = await pickArms(rules({ experiments: [], promoted: [promoted] }), 'user_1', {});
    expect(arms).toHaveLength(1);
    expect(arms[0].experimentId).toBe(PROMOTED);
    expect(arms[0].slug).toBe('old-test');
    expect(arms[0].variant.id).toBe(WINNER);
    expect(arms[0].exposure).toBe(false);
  });

  it('serves a Holdout member nothing', async () => {
    const arms = await pickArms(
      rules({
        experiments: [],
        promoted: [promoted],
        holdout: { id: HOLDOUT, percentage: 100, active: true },
      }),
      'user_1',
      {}
    );
    expect(arms).toEqual([]);
  });
});
