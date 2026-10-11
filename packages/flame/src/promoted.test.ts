import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import { TrackingManager } from './tracking';
import type { AssignmentResponse, PromotedExperiment, StoredAssignment } from './types';

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

// Shaped like ember's golden instance (experiments_active_promoted.json).
const promoted: PromotedExperiment = {
  id: 'exp-promoted',
  name: 'Promoted Contract',
  slug: 'promoted-contract',
  winner_promoted_at: '2026-10-10T12:00:00Z',
  winner: {
    id: 'variant-winner',
    experiment_id: 'exp-promoted',
    name: 'Treatment',
    description: 'Promoted copy',
    is_control: false,
    changes: [{ type: 'text', selector: '#headline', value: 'Promoted winner text' }],
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
  },
};

// ember's promotion short-circuit: the winner, and no assignment row.
const WINNER: AssignmentResponse = {
  assignment_id: null,
  experiment_id: 'exp-promoted',
  variant_id: 'variant-winner',
  variant_name: 'Treatment',
  is_control: false,
  assigned_at: null,
};

// The Holdout gate runs first (ember ADR 0024).
const HELD_OUT: AssignmentResponse = {
  assignment_id: null,
  experiment_id: 'exp-promoted',
  variant_id: null,
  variant_name: null,
  is_control: null,
  assigned_at: null,
  held_out: true,
};

// A returning visitor's sticky row from while the experiment ran.
const STORED_LOSER: StoredAssignment = {
  experimentId: 'exp-promoted',
  variantId: 'variant-loser',
  userId: 'someone',
  assignedAt: '2026-10-02T12:00:00Z',
};

function stubApi(assign: AssignmentResponse | (() => Response)) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/experiments/active')) {
      return new Response(JSON.stringify({ experiments: [], promoted: [promoted] }), {
        status: 200,
      });
    }
    if (url.endsWith('/experiments/exp-promoted/assign')) {
      return typeof assign === 'function'
        ? assign()
        : new Response(JSON.stringify(assign), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function assignCalls(fetchMock: ReturnType<typeof stubApi>): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/assign')).length;
}

function storedAssignments(): Record<string, StoredAssignment> {
  return JSON.parse(localStorage.getItem('flame_assignments') ?? '{}');
}

const headline = () => document.getElementById('headline')?.textContent;

// Each test's instances watch the shared document (flame#45), so stop them
// after the test, as a page has only one.
const instances: Flame[] = [];
function newFlame(): Flame {
  const f = new Flame();
  instances.push(f);
  return f;
}

describe('flame.init() with a promoted winner', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.body.innerHTML = '<h1 id="headline">Original headline</h1>';
  });

  afterEach(() => {
    instances.splice(0).forEach((f) => f.reset());
    delete (window as unknown as { __cupedAntiflicker?: unknown }).__cupedAntiflicker;
  });

  it('applies the winner when /assign names it', async () => {
    stubApi(WINNER);
    await newFlame().init({ dsn: DSN });

    expect(headline()).toBe('Promoted winner text');
  });

  it('renders the original for a held-out visitor', async () => {
    stubApi(HELD_OUT);
    await newFlame().init({ dsn: DSN });

    expect(headline()).toBe('Original headline');
  });

  it('renders the original when /assign names some other variant', async () => {
    stubApi({ ...WINNER, variant_id: 'variant-loser', variant_name: 'Control' });
    await newFlame().init({ dsn: DSN });

    expect(headline()).toBe('Original headline');
  });

  it('asks /assign even when a stored assignment exists, and leaves it untouched', async () => {
    localStorage.setItem('flame_assignments', JSON.stringify({ 'exp-promoted': STORED_LOSER }));
    const fetchMock = stubApi(WINNER);

    await newFlame().init({ dsn: DSN });

    expect(assignCalls(fetchMock)).toBe(1);
    expect(headline()).toBe('Promoted winner text');
    // Kept as-is, so a reverted promotion puts the visitor back in their
    // original sticky variant.
    expect(storedAssignments()['exp-promoted']).toEqual(STORED_LOSER);
  });

  it('stores nothing for the winner', async () => {
    stubApi(WINNER);
    await newFlame().init({ dsn: DSN });

    expect(storedAssignments()['exp-promoted']).toBeUndefined();
  });

  it('asks /assign on every page load', async () => {
    const fetchMock = stubApi(WINNER);
    await newFlame().init({ dsn: DSN });
    await newFlame().init({ dsn: DSN });

    expect(assignCalls(fetchMock)).toBe(2);
  });

  it('registers nothing for tracking and reports no variant', async () => {
    const registerAssignment = vi.spyOn(TrackingManager.prototype, 'registerAssignment');
    const registerGoals = vi.spyOn(TrackingManager.prototype, 'registerGoals');
    stubApi(WINNER);

    const flame = newFlame();
    await flame.init({ dsn: DSN });

    // The experiment is concluded: its results are frozen.
    expect(registerAssignment).not.toHaveBeenCalled();
    expect(registerGoals).not.toHaveBeenCalled();
    expect(flame.getVariant('exp-promoted')).toBeNull();
  });

  it('applies the winner before revealing an anti-flicker page', async () => {
    const reveal = vi.fn(() => {
      expect(headline()).toBe('Promoted winner text');
    });
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = {
      revealed: false,
      reveal,
    };
    stubApi(WINNER);

    await newFlame().init({ dsn: DSN });

    expect(reveal).toHaveBeenCalledOnce();
  });

  it('renders the original and still initializes when /assign fails', async () => {
    stubApi(() => new Response('boom', { status: 500 }));
    const flame = newFlame();
    await flame.init({ dsn: DSN });

    expect(headline()).toBe('Original headline');
    expect(flame.isInitialized()).toBe(true);
  });

  it('treats a response with no promoted list as none (older ember)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ experiments: [] }), { status: 200 }))
    );
    const flame = newFlame();
    await flame.init({ dsn: DSN });

    expect(flame.isInitialized()).toBe(true);
    expect(headline()).toBe('Original headline');
  });
});
