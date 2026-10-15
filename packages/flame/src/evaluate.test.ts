/**
 * Record on delivery (flame#46, ember ADR 0041). flame learns every arm in
 * one `POST /evaluate`, which enrols nobody, and records an arm with a
 * `$assignment` event only when it actually delivers it. A visitor the
 * anti-flicker timeout skips sees the original and is not measured in a
 * variant they never saw.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { Experiment, ExperimentEvaluation } from './types';

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

function makeExperiment(id: string, selector: string): Experiment {
  const base = {
    experiment_id: id,
    description: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
  return {
    id,
    project_id: 'proj-1',
    name: id,
    description: null,
    status: 'running',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    variants: [
      { ...base, id: `${id}-control`, name: 'Control', is_control: true, changes: [] },
      {
        ...base,
        id: `${id}-treatment`,
        name: 'Treatment',
        is_control: false,
        changes: [{ type: 'text', selector, value: `${id} variant` }],
      },
    ],
  };
}

const EXP_1 = makeExperiment('exp-1', '#one');
const EXP_2 = makeExperiment('exp-2', '#two');

function evaluation(experimentId: string, arm: 'control' | 'treatment'): ExperimentEvaluation {
  return {
    experiment_id: experimentId,
    variant_id: `${experimentId}-${arm}`,
    variant_name: arm === 'control' ? 'Control' : 'Treatment',
    is_control: arm === 'control',
    held_out: false,
    cap_reached: false,
    workspace_archived: false,
  };
}

function stubApi(experiments: Experiment[], evaluations: ExperimentEvaluation[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/experiments/active')) {
      return new Response(JSON.stringify({ experiments }), { status: 200 });
    }
    if (url.endsWith('/evaluate')) {
      return new Response(JSON.stringify({ evaluations }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof stubApi>, suffix: RegExp) =>
  fetchMock.mock.calls.filter(([input]) => suffix.test(String(input)));

// Each Flame keeps watching the page after init (flame#45). Reset them, or an
// earlier test's watcher re-applies its variant to the next test's DOM.
const started: Flame[] = [];
const fresh = () => {
  const flame = new Flame();
  started.push(flame);
  return flame;
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = '<h1 id="one">one original</h1><h1 id="two">two original</h1>';
});

afterEach(() => {
  started.splice(0).forEach((flame) => flame.reset());
  delete (window as unknown as { __cupedAntiflicker?: unknown }).__cupedAntiflicker;
});

describe('one evaluation at load', () => {
  it('asks /evaluate once for every experiment, never /assign, and applies the answers', async () => {
    const fetchMock = stubApi(
      [EXP_1, EXP_2],
      [evaluation('exp-1', 'treatment'), evaluation('exp-2', 'control')]
    );
    const flame = fresh();
    await flame.init({ dsn: DSN });

    const evaluate = calls(fetchMock, /\/evaluate$/);
    expect(evaluate).toHaveLength(1);
    expect(evaluate[0][1]?.method).toBe('POST');
    const body = JSON.parse(String(evaluate[0][1]?.body));
    expect(typeof body.user_id).toBe('string');
    expect(body.identity?.device_id).toBeTruthy();
    expect(calls(fetchMock, /\/assign$/)).toHaveLength(0);

    expect(document.getElementById('one')?.textContent).toBe('exp-1 variant');
    expect(document.getElementById('two')?.textContent).toBe('two original');
    expect(flame.getVariant('exp-1')).toBe('exp-1-treatment');
    expect(flame.getVariant('exp-2')).toBe('exp-2-control');
  });
});

describe('a malformed /evaluate answer', () => {
  it('a body with no evaluations list renders the original and still initializes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/experiments/active')) {
          return new Response(JSON.stringify({ experiments: [EXP_1] }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      })
    );
    const flame = fresh();
    await flame.init({ dsn: DSN });

    expect(flame.isInitialized()).toBe(true);
    expect(document.getElementById('one')?.textContent).toBe('one original');
    expect(flame.getVariant('exp-1')).toBeNull();
  });
});

describe('the arms cache', () => {
  const stored = () => JSON.parse(localStorage.getItem('flame_assignments') ?? '{}');

  it('caches the evaluated arm', async () => {
    stubApi([EXP_1], [evaluation('exp-1', 'treatment')]);
    await fresh().init({ dsn: DSN });

    expect(stored()['exp-1']?.variantId).toBe('exp-1-treatment');
  });

  it('a returning visitor with a cached arm gets it without asking /evaluate', async () => {
    localStorage.setItem(
      'flame_assignments',
      JSON.stringify({
        'exp-1': {
          experimentId: 'exp-1',
          variantId: 'exp-1-treatment',
          userId: 'u',
          assignedAt: 'x',
        },
      })
    );
    const fetchMock = stubApi([EXP_1], [evaluation('exp-1', 'control')]);
    const flame = fresh();
    await flame.init({ dsn: DSN });

    expect(calls(fetchMock, /\/evaluate$/)).toHaveLength(0);
    expect(flame.getVariant('exp-1')).toBe('exp-1-treatment');
    expect(document.getElementById('one')?.textContent).toBe('exp-1 variant');
  });

  it('a cached arm whose variant no longer exists is evaluated again', async () => {
    localStorage.setItem(
      'flame_assignments',
      JSON.stringify({
        'exp-1': { experimentId: 'exp-1', variantId: 'deleted-arm', userId: 'u', assignedAt: 'x' },
      })
    );
    const fetchMock = stubApi([EXP_1], [evaluation('exp-1', 'control')]);
    const flame = fresh();
    await flame.init({ dsn: DSN });

    expect(calls(fetchMock, /\/evaluate$/)).toHaveLength(1);
    expect(flame.getVariant('exp-1')).toBe('exp-1-control');
    expect(stored()['exp-1']?.variantId).toBe('exp-1-control');
  });
});
