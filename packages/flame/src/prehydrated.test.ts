import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Flame } from './index';
import type { PrehydratedState, Variant } from './types';

const variant: Variant = {
  id: 'variant-A',
  experiment_id: 'exp-1',
  name: 'green',
  description: null,
  is_control: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const prehydrated: PrehydratedState = {
  user_id: 'edge-user-123',
  user_id_created_at: '2024-01-01T00:00:00Z',
  experiments: [
    {
      id: 'exp-1',
      project_id: 'proj-1',
      name: 'Hero CTA',
      description: null,
      status: 'running',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      goals: [],
      variants: [variant],
    },
  ],
  assignments: {
    'exp-1': {
      experimentId: 'exp-1',
      variantId: 'variant-A',
      userId: 'edge-user-123',
      assignedAt: '2024-01-01T00:00:00Z',
    },
  },
};

describe('flame.init({ prehydrated })', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // Stub out fetch so any accidental HTTP call would scream loudly.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network call during prehydrated init — should not happen');
      })
    );
  });

  it('skips the API fetch and uses the supplied assignment', async () => {
    const flame = new Flame();
    await flame.init({ dsn: 'https://0123456789abcdef0123456789abcdef@example.com', prehydrated });

    expect(flame.getVariant('exp-1')).toBe('variant-A');
    const info = flame.getAssignedVariantInfo('exp-1');
    expect(info?.name).toBe('green');
    expect(info?.is_control).toBe(false);
  });

  it('seeds device id from prehydrated.user_id', async () => {
    expect(localStorage.getItem('flame_device_id')).toBeNull();
    const flame = new Flame();
    await flame.init({ dsn: 'https://0123456789abcdef0123456789abcdef@example.com', prehydrated });
    expect(localStorage.getItem('flame_device_id')).toBe('edge-user-123');
  });

  it('does not clobber an existing device id', async () => {
    localStorage.setItem('flame_device_id', 'pre-existing-id');
    localStorage.setItem('flame_device_id_created_at', '2020-06-01T00:00:00Z');

    const flame = new Flame();
    await flame.init({ dsn: 'https://0123456789abcdef0123456789abcdef@example.com', prehydrated });

    expect(localStorage.getItem('flame_device_id')).toBe('pre-existing-id');
  });

  it('returns null for experiments not in prehydrated state', async () => {
    const flame = new Flame();
    await flame.init({ dsn: 'https://0123456789abcdef0123456789abcdef@example.com', prehydrated });
    expect(flame.getVariant('unknown-exp')).toBeNull();
    expect(flame.getAssignedVariantInfo('unknown-exp')).toBeNull();
  });

  it('marks the SDK as initialized after prehydrated init', async () => {
    const flame = new Flame();
    expect(flame.isInitialized()).toBe(false);
    await flame.init({ dsn: 'https://0123456789abcdef0123456789abcdef@example.com', prehydrated });
    expect(flame.isInitialized()).toBe(true);
  });

  it('handles experiments with no matching prehydrated assignment', async () => {
    const partial: PrehydratedState = {
      ...prehydrated,
      assignments: {}, // no assignments — experiments still listed
    };
    const flame = new Flame();
    await flame.init({ dsn: 'https://0123456789abcdef0123456789abcdef@example.com', prehydrated: partial });

    // Init still completes, just no variants assigned.
    expect(flame.isInitialized()).toBe(true);
    expect(flame.getVariant('exp-1')).toBeNull();
  });
});
