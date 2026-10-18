import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { PrehydratedState, Variant } from './types';

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

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

type SentEvent = {
  user_id: string;
  event_type: string;
  metadata?: Record<string, unknown>;
  experiment_assignments?: { experiment_id: string; variant_id: string }[];
};

/** Every event flame sends to /events. jsdom has no sendBeacon, so they go by fetch. */
let sent: SentEvent[] = [];
const records = () => sent.filter((e) => e.event_type === '$assignment');

describe('flame.init({ prehydrated })', () => {
  beforeEach(() => {
    sent = [];
    localStorage.clear();
    vi.restoreAllMocks();
    // Events may go out; any other HTTP call would scream loudly.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith('/events') && init?.body) {
          sent.push(...(JSON.parse(String(init.body)).events as SentEvent[]));
          return new Response(null, { status: 204 });
        }
        throw new Error('network call during prehydrated init — should not happen');
      })
    );
  });

  afterEach(() => {
    delete (window as unknown as { __cupedAntiflicker?: unknown }).__cupedAntiflicker;
  });

  it('skips the API fetch and uses the supplied assignment', async () => {
    const flame = new Flame();
    await flame.init({ dsn: DSN, prehydrated });

    expect(flame.getVariant('exp-1')).toBe('variant-A');
    const info = flame.getAssignedVariantInfo('exp-1');
    expect(info?.name).toBe('green');
    expect(info?.is_control).toBe(false);
  });

  it('seeds device id from prehydrated.user_id', async () => {
    expect(localStorage.getItem('flame_device_id')).toBeNull();
    const flame = new Flame();
    await flame.init({ dsn: DSN, prehydrated });
    expect(localStorage.getItem('flame_device_id')).toBe('edge-user-123');
  });

  it('does not clobber an existing device id', async () => {
    localStorage.setItem('flame_device_id', 'pre-existing-id');
    localStorage.setItem('flame_device_id_created_at', '2020-06-01T00:00:00Z');

    const flame = new Flame();
    await flame.init({ dsn: DSN, prehydrated });

    expect(localStorage.getItem('flame_device_id')).toBe('pre-existing-id');
  });

  it('returns null for experiments not in prehydrated state', async () => {
    const flame = new Flame();
    await flame.init({ dsn: DSN, prehydrated });
    expect(flame.getVariant('unknown-exp')).toBeNull();
    expect(flame.getAssignedVariantInfo('unknown-exp')).toBeNull();
  });

  it('marks the SDK as initialized after prehydrated init', async () => {
    const flame = new Flame();
    expect(flame.isInitialized()).toBe(false);
    await flame.init({ dsn: DSN, prehydrated });
    expect(flame.isInitialized()).toBe(true);
  });

  it('handles experiments with no matching prehydrated assignment', async () => {
    const partial: PrehydratedState = {
      ...prehydrated,
      assignments: {}, // no assignments — experiments still listed
    };
    const flame = new Flame();
    await flame.init({ dsn: DSN, prehydrated: partial });

    // Init still completes, just no variants assigned.
    expect(flame.isInitialized()).toBe(true);
    expect(flame.getVariant('exp-1')).toBeNull();
  });

  // flame-edge only evaluates (flame#47): the page that delivers the arm
  // records it, as for an arm flame evaluated itself (flame#46).
  it('records the prehydrated arm it delivers, as the edge user', async () => {
    const flame = new Flame();
    await flame.init({ dsn: DSN, prehydrated, enableBatching: false });

    await vi.waitFor(() => expect(sent.some((e) => e.event_type === 'pageview')).toBe(true));
    expect(records()).toHaveLength(1);
    expect(records()[0].user_id).toBe('edge-user-123');
    expect(records()[0].metadata).toMatchObject({
      experiment_id: 'exp-1',
      variant_id: 'variant-A',
    });
    // The record goes before anything tagged with its arm.
    const pageview = sent.findIndex((e) => e.event_type === 'pageview');
    expect(sent.indexOf(records()[0])).toBeLessThan(pageview);
    expect(sent[pageview].experiment_assignments).toEqual([
      { experiment_id: 'exp-1', variant_id: 'variant-A' },
    ]);
  });

  it('does not record a prehydrated arm again on the next page load', async () => {
    await new Flame().init({ dsn: DSN, prehydrated, enableBatching: false });
    await vi.waitFor(() => expect(records()).toHaveLength(1));

    const next = new Flame();
    await next.init({ dsn: DSN, prehydrated, enableBatching: false });
    await vi.waitFor(() => expect(sent.filter((e) => e.event_type === 'pageview')).toHaveLength(2));
    expect(records()).toHaveLength(1);
    expect(next.getVariant('exp-1')).toBe('variant-A');
  });

  it('neither records nor tags a prehydrated arm the anti-flicker timeout skipped', async () => {
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = {
      revealed: true,
      reveal: () => {},
    };
    const flame = new Flame();
    await flame.init({ dsn: DSN, prehydrated, enableBatching: false });

    await vi.waitFor(() => expect(sent.some((e) => e.event_type === 'pageview')).toBe(true));
    expect(records()).toHaveLength(0);
    expect(sent.find((e) => e.event_type === 'pageview')?.experiment_assignments ?? []).toEqual([]);
    expect(flame.getVariant('exp-1')).toBeNull();
  });
});
