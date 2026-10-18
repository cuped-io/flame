/**
 * Page targeting (flame#50). An experiment with a `url_pattern` assigns and
 * counts a visitor only on a page that matches: elsewhere flame neither
 * records the arm nor applies it. A single-page app is re-checked when its
 * URL changes without a page load.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { Experiment, ExperimentEvaluation, FlameConfig, PrehydratedState } from './types';

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

function makeExperiment(urlPattern: string | null): Experiment {
  const base = {
    experiment_id: 'exp-1',
    description: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
  return {
    id: 'exp-1',
    project_id: 'proj-1',
    name: 'Pricing headline',
    description: null,
    status: 'running',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    url_pattern: urlPattern,
    variants: [
      {
        ...base,
        id: 'exp-1-treatment',
        name: 'Treatment',
        is_control: false,
        changes: [{ type: 'text', selector: '#headline', value: 'variant' }],
      },
    ],
  };
}

const TREATMENT: ExperimentEvaluation = {
  experiment_id: 'exp-1',
  variant_id: 'exp-1-treatment',
  variant_name: 'Treatment',
  is_control: false,
  resolution: 'assigned',
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
const pageviews = () => sent.filter((e) => e.event_type === 'pageview');
const headline = () => document.getElementById('headline')?.textContent;

function stubApi(
  experiments: Experiment[],
  evaluate: () => ExperimentEvaluation | ExperimentEvaluation[] = () => TREATMENT
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/events') && init?.body) {
        sent.push(...(JSON.parse(String(init.body)).events as SentEvent[]));
        return new Response(null, { status: 204 });
      }
      if (url.endsWith('/experiments/active')) {
        return new Response(JSON.stringify({ experiments }), { status: 200 });
      }
      if (url.endsWith('/evaluate')) {
        return new Response(JSON.stringify({ evaluations: [evaluate()].flat() }), {
          status: 200,
        });
      }
      return new Response('{}', { status: 200 });
    })
  );
}

// Each Flame keeps watching the page after init (flame#45): reset them.
const started: Flame[] = [];
const resetStarted = () => started.splice(0).forEach((flame) => flame.reset());
async function initOn(
  path: string,
  experiments: Experiment[],
  config: Partial<FlameConfig> = {}
): Promise<Flame> {
  history.replaceState(null, '', path);
  stubApi(experiments);
  const flame = new Flame();
  started.push(flame);
  await flame.init({ dsn: DSN, enableBatching: false, ...config });
  await vi.waitFor(() => expect(pageviews().length).toBeGreaterThan(0));
  return flame;
}

beforeEach(() => {
  sent = [];
  localStorage.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = '<h1 id="headline">original</h1>';
});

afterEach(() => {
  resetStarted();
  history.replaceState(null, '', '/');
});

describe('on a page the pattern does not match', () => {
  it('neither records, applies nor tags the arm', async () => {
    const flame = await initOn('/about', [makeExperiment('/pricing')]);

    expect(records()).toHaveLength(0);
    expect(headline()).toBe('original');
    expect(pageviews()[0].experiment_assignments ?? []).toEqual([]);
    expect(flame.getVariant('exp-1')).toBeNull();
  });
});

describe('on a page the pattern matches', () => {
  it('records and applies the arm, and the record names the page', async () => {
    const flame = await initOn('/pricing/?plan=pro#faq', [makeExperiment('/pricing')]);

    expect(headline()).toBe('variant');
    expect(flame.getVariant('exp-1')).toBe('exp-1-treatment');
    expect(records()).toHaveLength(1);
    // ember writes no row for a record whose path does not match (ember#336).
    expect(records()[0].metadata).toMatchObject({
      experiment_id: 'exp-1',
      variant_id: 'exp-1-treatment',
      path: '/pricing/',
    });
  });

  it('an experiment with no pattern runs on every page', async () => {
    await initOn('/anywhere', [makeExperiment(null)]);

    expect(headline()).toBe('variant');
    expect(records()).toHaveLength(1);
  });
});

describe('a visitor already counted on a matching page', () => {
  it('carries the arm on other pages, so a conversion there is attributed, but sees no change', async () => {
    await initOn('/pricing', [makeExperiment('/pricing')]);
    expect(records()).toHaveLength(1);

    resetStarted();
    sent = [];
    document.body.innerHTML = '<h1 id="headline">original</h1>';
    const flame = await initOn('/checkout', [makeExperiment('/pricing')]);

    expect(records()).toHaveLength(0);
    expect(headline()).toBe('original');
    expect(pageviews()[0].experiment_assignments).toEqual([
      { experiment_id: 'exp-1', variant_id: 'exp-1-treatment' },
    ]);
    expect(flame.getVariant('exp-1')).toBe('exp-1-treatment');
  });
});

describe('a single-page app', () => {
  it('records and applies the arm when it navigates onto a matching page', async () => {
    const flame = await initOn('/about', [makeExperiment('/pricing')]);
    expect(records()).toHaveLength(0);

    history.pushState(null, '', '/pricing');

    await vi.waitFor(() => expect(records()).toHaveLength(1));
    expect(records()[0].metadata).toMatchObject({ path: '/pricing' });
    expect(headline()).toBe('variant');
    expect(flame.getVariant('exp-1')).toBe('exp-1-treatment');
  });

  it('re-checks on back and forward navigation', async () => {
    await initOn('/about', [makeExperiment('/pricing')]);

    history.replaceState(null, '', '/pricing'); // what the browser shows after "back"
    window.dispatchEvent(new PopStateEvent('popstate'));

    await vi.waitFor(() => expect(records()).toHaveLength(1));
    expect(headline()).toBe('variant');
  });

  it('stops re-applying the change once it navigates off the matching pages', async () => {
    await initOn('/pricing', [makeExperiment('/pricing')]);
    expect(headline()).toBe('variant');

    // The app routes to /about and renders a fresh headline there.
    history.pushState(null, '', '/about');
    document.body.innerHTML = '<h1 id="headline">about</h1>';
    await new Promise((r) => setTimeout(r, 20));

    expect(headline()).toBe('about');
  });

  it('records nothing after reset, even when the URL changes', async () => {
    const flame = await initOn('/about', [makeExperiment('/pricing')]);
    flame.reset();

    history.pushState(null, '', '/pricing');
    await new Promise((r) => setTimeout(r, 20));

    expect(records()).toHaveLength(0);
    expect(headline()).toBe('original');
  });
});

describe('an arm flame-edge resolved', () => {
  const prehydrated = (experiment: Experiment): PrehydratedState => ({
    user_id: 'edge-user',
    experiments: [experiment],
    assignments: {
      'exp-1': {
        experimentId: 'exp-1',
        variantId: 'exp-1-treatment',
        userId: 'edge-user',
        assignedAt: '2024-01-01T00:00:00Z',
      },
    },
  });

  it('is gated by the page like any other', async () => {
    await initOn('/about', [], { prehydrated: prehydrated(makeExperiment('/pricing')) });
    expect(records()).toHaveLength(0);
    expect(headline()).toBe('original');

    history.pushState(null, '', '/pricing');
    await vi.waitFor(() => expect(records()).toHaveLength(1));
    expect(records()[0].user_id).toBe('edge-user');
    expect(headline()).toBe('variant');
  });
});

describe('withdrawing consent, then accepting again on the same page', () => {
  it("applies the new visitor's arm, not only records it", async () => {
    const experiment = makeExperiment('/pricing');
    experiment.variants!.push({
      ...experiment.variants![0],
      id: 'exp-1-b',
      name: 'B',
      changes: [{ type: 'text', selector: '#headline', value: 'variant B' }],
    });
    const answers = [TREATMENT, { ...TREATMENT, variant_id: 'exp-1-b', variant_name: 'B' }];
    history.replaceState(null, '', '/pricing');
    stubApi([experiment], () => answers.shift()!);
    const flame = new Flame();
    started.push(flame);
    await flame.init({ dsn: DSN, enableBatching: false, requireConsent: true });

    flame.consent(true);
    await vi.waitFor(() => expect(headline()).toBe('variant'));
    flame.consent(false);
    flame.consent(true);

    await vi.waitFor(() =>
      expect(records().map((r) => r.metadata?.variant_id)).toContain('exp-1-b')
    );
    expect(flame.getVariant('exp-1')).toBe('exp-1-b');
    expect(headline()).toBe('variant B');
  });
});

describe('navigating off the matching pages', () => {
  it('undoes the change on what stays on screen, and keeps experiments that still run', async () => {
    const everywhere: Experiment = {
      ...makeExperiment(null),
      id: 'exp-2',
      variants: [
        {
          ...makeExperiment(null).variants![0],
          id: 'exp-2-treatment',
          experiment_id: 'exp-2',
          changes: [{ type: 'text', selector: '#footer', value: 'footer variant' }],
        },
      ],
    };
    document.body.innerHTML = '<h1 id="headline">original</h1><p id="footer">footer</p>';
    history.replaceState(null, '', '/pricing');
    stubApi([makeExperiment('/pricing'), everywhere], () => [
      TREATMENT,
      { ...TREATMENT, experiment_id: 'exp-2', variant_id: 'exp-2-treatment' },
    ]);
    const flame = new Flame();
    started.push(flame);
    await flame.init({ dsn: DSN, enableBatching: false });
    expect(headline()).toBe('variant');

    // The headline is in a layout the app keeps across routes.
    history.pushState(null, '', '/about');
    expect(headline()).toBe('original');
    expect(document.getElementById('footer')?.textContent).toBe('footer variant');

    // Back on a matching page, the change returns, with no second record.
    history.pushState(null, '', '/pricing');
    expect(headline()).toBe('variant');
    expect(records().filter((r) => r.metadata?.experiment_id === 'exp-1')).toHaveLength(1);
  });
});

describe('after the anti-flicker timeout revealed the original', () => {
  afterEach(() => {
    delete (window as unknown as { __cupedAntiflicker?: unknown }).__cupedAntiflicker;
  });

  it('still delivers on a later client-side navigation, once the app renders the target', async () => {
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = {
      revealed: true,
      reveal: () => {},
    };
    await initOn('/about', [makeExperiment('/pricing')]);
    expect(records()).toHaveLength(0);

    // The app routes first and renders the new page after.
    document.body.innerHTML = '';
    history.pushState(null, '', '/pricing');
    document.body.innerHTML = '<h1 id="headline">original</h1>';

    await vi.waitFor(() => expect(headline()).toBe('variant'));
    expect(records()).toHaveLength(1);
  });
});
