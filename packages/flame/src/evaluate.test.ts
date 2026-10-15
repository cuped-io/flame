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

type SentEvent = {
  user_id: string;
  event_type: string;
  metadata?: Record<string, unknown>;
  experiment_assignments?: { experiment_id: string; variant_id: string }[];
  occurred_at?: string;
};

/** Every event flame sends to /events, in order. jsdom has no sendBeacon, so they go by fetch. */
let sent: SentEvent[] = [];
const records = () => sent.filter((e) => e.event_type === '$assignment');

function stubApi(experiments: Experiment[], evaluations: ExperimentEvaluation[]) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/events') && init?.body) {
      sent.push(...(JSON.parse(String(init.body)).events as SentEvent[]));
      return new Response(null, { status: 204 });
    }
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
  sent = [];
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

describe('recording on delivery', () => {
  it('records each delivered arm, control too, as a $assignment event ember accepts', async () => {
    stubApi([EXP_1, EXP_2], [evaluation('exp-1', 'treatment'), evaluation('exp-2', 'control')]);
    const before = Date.now();
    await fresh().init({ dsn: DSN, enableBatching: false });

    await vi.waitFor(() => expect(records()).toHaveLength(2));
    const byExperiment = Object.fromEntries(records().map((r) => [r.metadata?.experiment_id, r]));
    expect(byExperiment['exp-1'].metadata?.variant_id).toBe('exp-1-treatment');
    expect(byExperiment['exp-2'].metadata?.variant_id).toBe('exp-2-control');
    for (const record of records()) {
      expect(typeof record.user_id).toBe('string');
      expect(record.user_id.length).toBeGreaterThan(0);
      // ember dates the row from occurred_at, capped at receipt.
      expect(Date.parse(record.occurred_at!)).toBeGreaterThanOrEqual(before - 1000);
      // A record is not an event to attribute.
      expect(record.experiment_assignments).toBeUndefined();
    }
  });

  it('records a variant even when none of its changes land on the page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = makeExperiment('exp-1', '#one[');
    stubApi([broken], [evaluation('exp-1', 'treatment')]);
    await fresh().init({ dsn: DSN, enableBatching: false });

    await vi.waitFor(() => expect(records()).toHaveLength(1));
    expect(records()[0].metadata?.variant_id).toBe('exp-1-treatment');
  });

  it('carries the identity ember uses for CUPED eligibility', async () => {
    stubApi([EXP_1], [evaluation('exp-1', 'control')]);
    await fresh().init({ dsn: DSN, enableBatching: false });

    await vi.waitFor(() => expect(records()).toHaveLength(1));
    const identity = records()[0].metadata?.identity as { device_id?: string; type?: string };
    expect(identity?.device_id).toBeTruthy();
    expect(identity?.type).toBeTruthy();
  });

  it('records nothing for a held-out visitor', async () => {
    stubApi(
      [EXP_1],
      [
        {
          ...evaluation('exp-1', 'control'),
          variant_id: null,
          variant_name: null,
          is_control: null,
          held_out: true,
        },
      ]
    );
    await fresh().init({ dsn: DSN, enableBatching: false });

    await vi.waitFor(() => expect(sent.some((e) => e.event_type === 'pageview')).toBe(true));
    expect(records()).toHaveLength(0);
  });

  it('records nothing for prehydrated arms: flame-edge records those (flame#47)', async () => {
    stubApi([], []);
    await fresh().init({
      dsn: DSN,
      enableBatching: false,
      prehydrated: {
        user_id: 'edge-user',
        user_id_created_at: '2024-01-01T00:00:00Z',
        experiments: [EXP_1],
        assignments: {
          'exp-1': {
            experimentId: 'exp-1',
            variantId: 'exp-1-treatment',
            userId: 'edge-user',
            assignedAt: 'x',
          },
        },
      },
    });

    expect(document.getElementById('one')?.textContent).toBe('exp-1 variant');
    await vi.waitFor(() => expect(sent.some((e) => e.event_type === 'pageview')).toBe(true));
    expect(records()).toHaveLength(0);
  });
});

describe('when the anti-flicker timeout wins', () => {
  const revealedAlready = () => {
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = {
      revealed: true,
      reveal: vi.fn(),
    };
  };
  const pageviews = () => sent.filter((e) => e.event_type === 'pageview');

  it('the visitor sees the original, is not recorded, and their events carry no arm', async () => {
    revealedAlready();
    stubApi([EXP_1, EXP_2], [evaluation('exp-1', 'treatment'), evaluation('exp-2', 'control')]);
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });

    await vi.waitFor(() => expect(pageviews()).toHaveLength(1));
    expect(document.getElementById('one')?.textContent).toBe('one original');
    expect(records()).toHaveLength(0);
    expect(pageviews()[0].experiment_assignments).toBeUndefined();
    expect(flame.getVariant('exp-1')).toBeNull();
    expect(flame.getVariant('exp-2')).toBeNull();
  });

  it('positive control: delivered, the pageview carries both arms', async () => {
    stubApi([EXP_1, EXP_2], [evaluation('exp-1', 'treatment'), evaluation('exp-2', 'control')]);
    await fresh().init({ dsn: DSN, enableBatching: false });

    await vi.waitFor(() => expect(pageviews()).toHaveLength(1));
    expect(pageviews()[0].experiment_assignments).toEqual(
      expect.arrayContaining([
        { experiment_id: 'exp-1', variant_id: 'exp-1-treatment' },
        { experiment_id: 'exp-2', variant_id: 'exp-2-control' },
      ])
    );
  });
});
