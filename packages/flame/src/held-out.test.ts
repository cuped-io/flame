import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import { TrackingManager } from './tracking';
import type { AssignmentResponse, Experiment } from './types';
import { evaluateBody } from './test-evaluation';

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

const experiment: Experiment = {
  id: 'exp-1',
  project_id: 'proj-1',
  name: 'Hero CTA',
  description: null,
  status: 'running',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  goals: [{ name: 'cta_click', type: 'click', selector: '#cta' }],
  variants: [
    {
      id: 'variant-A',
      experiment_id: 'exp-1',
      name: 'green',
      description: null,
      is_control: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      changes: [{ type: 'text', selector: '#headline', value: 'Variant headline' }],
    },
  ],
};

// ember's 200-with-no-variant shape (ADR 0024 / 0034 / 0001).
const NO_VARIANT: Omit<AssignmentResponse, 'resolution'> = {
  assignment_id: null,
  experiment_id: 'exp-1',
  variant_id: null,
  variant_name: null,
  is_control: null,
  assigned_at: null,
};

function stubApi(assign: AssignmentResponse) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/experiments/active')) {
      return new Response(JSON.stringify({ experiments: [experiment] }), { status: 200 });
    }
    if (url.endsWith('/evaluate')) {
      return new Response(evaluateBody(assign), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function evaluateCalls(fetchMock: ReturnType<typeof stubApi>): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/evaluate')).length;
}

describe.each<[string, AssignmentResponse]>([
  ['held out', { ...NO_VARIANT, resolution: 'held_out' }],
  ['cap reached', { ...NO_VARIANT, resolution: 'cap_reached' }],
  ['workspace archived', { ...NO_VARIANT, resolution: 'workspace_archived' }],
])('flame.init() when %s', (_arm, response) => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.body.innerHTML = '<h1 id="headline">Original headline</h1>';
  });

  afterEach(() => {
    delete (window as unknown as { __cupedAntiflicker?: unknown }).__cupedAntiflicker;
  });

  it('renders the original and reports no variant', async () => {
    stubApi(response);
    const flame = new Flame();
    await flame.init({ dsn: DSN });

    expect(document.getElementById('headline')?.textContent).toBe('Original headline');
    expect(flame.getVariant('exp-1')).toBeNull();
    expect(flame.getAssignedVariantInfo('exp-1')).toBeNull();
    expect(flame.isInVariant('exp-1', 'green')).toBe(false);
    expect(flame.isInitialized()).toBe(true);
  });

  it('is silent: no console error or warning, and asks /evaluate exactly once', async () => {
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const fetchMock = stubApi(response);

    const flame = new Flame();
    await flame.init({ dsn: DSN });

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(evaluateCalls(fetchMock)).toBe(1);
  });

  it('reveals an anti-flicker page immediately', async () => {
    const reveal = vi.fn();
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = {
      revealed: false,
      reveal,
    };
    stubApi(response);

    const flame = new Flame();
    await flame.init({ dsn: DSN });

    expect(reveal).toHaveBeenCalledOnce();
  });

  it('attaches no experiment to events but still tracks its goals', async () => {
    const registerAssignment = vi.spyOn(TrackingManager.prototype, 'registerAssignment');
    const registerGoals = vi.spyOn(TrackingManager.prototype, 'registerGoals');
    stubApi(response);

    const flame = new Flame();
    await flame.init({ dsn: DSN });

    // In no variant, so events carry no assignment for this experiment...
    expect(registerAssignment).not.toHaveBeenCalled();
    // ...but its goals still fire, so a held-out user's conversions reach
    // the Holdout comparison.
    expect(registerGoals).toHaveBeenCalledWith('exp-1', experiment.goals);
  });

  it('asks again on the next page load instead of caching the refusal', async () => {
    const fetchMock = stubApi(response);
    await new Flame().init({ dsn: DSN });
    await new Flame().init({ dsn: DSN });

    expect(evaluateCalls(fetchMock)).toBe(2);
  });
});

describe('flame.init({ prehydrated }) with a variant-less assignment', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
  });

  it('treats it as no variant (cookie signed by an older flame-edge)', async () => {
    const registerAssignment = vi.spyOn(TrackingManager.prototype, 'registerAssignment');
    const flame = new Flame();
    await flame.init({
      dsn: DSN,
      prehydrated: {
        user_id: 'edge-user',
        experiments: [experiment],
        assignments: {
          // What flame-edge stored for a held-out user before it learned
          // to omit them.
          'exp-1': {
            experimentId: 'exp-1',
            variantId: null as unknown as string,
            userId: 'edge-user',
            assignedAt: null as unknown as string,
          },
        },
      },
    });

    expect(flame.getVariant('exp-1')).toBeNull();
    expect(registerAssignment).not.toHaveBeenCalled();
  });
});
