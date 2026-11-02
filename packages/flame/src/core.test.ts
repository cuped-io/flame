/**
 * The new core (flame#24): flame picks arms from the project's rules file
 * (ember#309) without waiting on ember, and records an arm only when page
 * code reads it. Expected arms come from ember's golden vectors: user-1 with
 * weights control 1 / treatment 3 lands on treatment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { RulesFile } from './rules';

const API_KEY = '0123456789abcdef0123456789abcdef';
const DSN = `https://${API_KEY}@example.com`;
const EXP = '550e8400-e29b-41d4-a716-446655440001';
const CONTROL = '11111111-1111-1111-1111-111111111111';
const TREATMENT = '22222222-2222-2222-2222-222222222222';

function rulesFile(overrides: Partial<RulesFile> = {}): RulesFile {
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

type SentEvent = {
  user_id: string;
  event_type: string;
  metadata?: Record<string, unknown>;
  experiment_assignments?: { experiment_id: string; variant_id: string }[];
};

let sent: SentEvent[] = [];
let requests: string[] = [];
const records = () => sent.filter((e) => e.event_type === '$assignment');
const pageviews = () => sent.filter((e) => e.event_type === 'pageview');

/**
 * `/rules` answers with `rules` (a status number: that error), once `gate`
 * resolves. Like a real fetch, an abort while it waits rejects it. Every event
 * sent lands in `sent`, every request URL in `requests`.
 */
function stubApi(rules: RulesFile | number = rulesFile(), gate?: Promise<void>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push(url);
      if (url.endsWith('/events') && init?.body) {
        sent.push(...(JSON.parse(String(init.body)).events as SentEvent[]));
        return new Response(null, { status: 204 });
      }
      if (url === `https://example.com/${API_KEY}/rules`) {
        await Promise.race([gate, aborted(init?.signal)]);
        return typeof rules === 'number'
          ? new Response('nope', { status: rules })
          : new Response(JSON.stringify(rules), { status: 200 });
      }
      return new Response('unexpected', { status: 404 });
    })
  );
}

/** Rejects as fetch does when `signal` aborts; never settles without one. */
function aborted(signal?: AbortSignal | null): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason));
  });
}

const started: Flame[] = [];
const fresh = () => {
  const flame = new Flame();
  started.push(flame);
  return flame;
};

beforeEach(() => {
  sent = [];
  requests = [];
  localStorage.clear();
  localStorage.setItem('flame_device_id', 'user-1');
  vi.restoreAllMocks();
});

afterEach(() => {
  started.splice(0).forEach((flame) => flame.reset());
});

describe('a new visitor', () => {
  it("reads ember's arm after only the rules-file fetch, and that read records it", async () => {
    stubApi();
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    expect(requests.filter((u) => !u.endsWith('/events'))).toEqual([
      `https://example.com/${API_KEY}/rules`,
    ]);
    expect(records()).toEqual([]);

    expect(flame.getVariant(EXP)).toBe(TREATMENT);
    await vi.waitFor(() => expect(records()).toHaveLength(1));
    expect(records()[0].user_id).toBe('user-1');
    expect(records()[0].metadata).toMatchObject({
      experiment_id: EXP,
      variant_id: TREATMENT,
      path: window.location.pathname,
    });
  });
});

/** Visit once, read the arm, and let the record go out: a returning visitor's state. */
async function visitAndRead() {
  stubApi();
  const first = fresh();
  await first.init({ dsn: DSN, enableBatching: false });
  first.getVariant(EXP);
  await vi.waitFor(() => expect(records()).toHaveLength(1));
  first.reset();
  sent = [];
  requests = [];
}

describe('a returning visitor', () => {
  it('reads the saved arm with no request before the read, and is not recorded again', async () => {
    await visitAndRead();
    // The rules file never answers on this load: the stored copy serves.
    stubApi(rulesFile(), new Promise(() => {}));
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    expect(flame.getVariant(EXP)).toBe(TREATMENT);
    expect(flame.getVariant('hero-cta')).toBe(TREATMENT);
    await new Promise((r) => setTimeout(r, 10));
    expect(records()).toEqual([]);
  });

  it('sends the pageview at once, carrying the arm recorded on the earlier visit', async () => {
    await visitAndRead();
    stubApi(rulesFile(), new Promise(() => {}));
    void fresh().init({ dsn: DSN, enableBatching: false });
    await vi.waitFor(() => expect(pageviews()).toHaveLength(1));
    expect(pageviews()[0].experiment_assignments).toEqual([
      { experiment_id: EXP, variant_id: TREATMENT },
    ]);
  });
});

describe('from the rules file', () => {
  // Golden vectors: user_1's bucket for this Holdout is 2921, under 100%.
  const holdout = { id: '550e8400-e29b-41d4-a716-446655440000', percentage: 100, active: true };
  const promoted = {
    id: '99999999-9999-9999-9999-999999999999',
    slug: 'old-test',
    url_pattern: null,
    winner_promoted_at: '2026-01-01T00:00:00Z',
    winner: {
      id: '88888888-8888-8888-8888-888888888888',
      name: 'Winner',
      is_control: false,
      weight: 1,
    },
  };

  it('a Holdout member reads control and is never recorded', async () => {
    localStorage.setItem('flame_device_id', 'user_1');
    stubApi(rulesFile({ holdout, promoted: [promoted] }));
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    expect(flame.getVariant(EXP)).toBe(CONTROL);
    expect(flame.getVariant('old-test')).toBeNull();
    flame.track('signup');
    await vi.waitFor(() => expect(sent.filter((e) => e.event_type === 'signup')).toHaveLength(1));
    expect(records()).toEqual([]);
    expect(sent.every((e) => !e.experiment_assignments)).toBe(true);
  });

  it('a promoted winner is read by everyone else, and never recorded', async () => {
    stubApi(rulesFile({ promoted: [promoted] }));
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    expect(flame.getAssignedVariantInfo('old-test')?.name).toBe('Winner');
    await new Promise((r) => setTimeout(r, 10));
    expect(records()).toEqual([]);
  });
});

describe('exposure on read', () => {
  it('a visitor whose page never reads an arm is never recorded in that experiment', async () => {
    stubApi();
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    flame.track('signup');
    await vi.waitFor(() => expect(sent.filter((e) => e.event_type === 'signup')).toHaveLength(1));
    expect(records()).toEqual([]);
    expect(sent.every((e) => !e.experiment_assignments)).toBe(true);
  });

  it('records once however often the page reads, and track() then carries the arm', async () => {
    stubApi();
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    flame.getVariant(EXP);
    flame.getAssignedVariantInfo('hero-cta');
    expect(flame.isInVariant(EXP, 'Treatment')).toBe(true);
    flame.track('signup');
    await vi.waitFor(() => expect(sent.filter((e) => e.event_type === 'signup')).toHaveLength(1));
    expect(records()).toHaveLength(1);
    expect(sent.find((e) => e.event_type === 'signup')?.experiment_assignments).toEqual([
      { experiment_id: EXP, variant_id: TREATMENT },
    ]);
  });

  it('a read before flame is ready returns null and records nothing', async () => {
    let answer!: () => void;
    stubApi(rulesFile(), new Promise((r) => (answer = r)));
    const flame = fresh();
    const init = flame.init({ dsn: DSN, enableBatching: false });
    expect(flame.getVariant(EXP)).toBeNull();
    answer();
    await init;
    await new Promise((r) => setTimeout(r, 10));
    expect(records()).toEqual([]);
  });

  it("a page outside the experiment's pattern reads control and records nothing", async () => {
    stubApi(
      rulesFile({
        experiments: [{ ...rulesFile().experiments[0], url_pattern: '/pricing' }],
      })
    );
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    expect(flame.getVariant(EXP)).toBe(CONTROL);
    await new Promise((r) => setTimeout(r, 10));
    expect(records()).toEqual([]);
  });
});

describe('the ready signal', () => {
  it('resolves the ready promise and dispatches flame:ready once reads answer', async () => {
    let answer!: () => void;
    stubApi(rulesFile(), new Promise((r) => (answer = r)));
    const flame = fresh();
    const heard = vi.fn(() => flame.getVariant(EXP));
    window.addEventListener('flame:ready', heard, { once: true });
    void flame.init({ dsn: DSN, enableBatching: false });
    expect(flame.isInitialized()).toBe(false);
    answer();
    await flame.ready;
    expect(flame.isInitialized()).toBe(true);
    expect(heard).toHaveReturnedWith(TREATMENT);
  });
});

describe('an unreachable rules file with no stored copy', () => {
  it('gives control, records nothing, and completes init', async () => {
    stubApi(503);
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    await flame.ready;
    expect(flame.isInitialized()).toBe(true);
    expect(flame.getVariant(EXP)).toBeNull();
    await vi.waitFor(() => expect(pageviews()).toHaveLength(1));
    expect(records()).toEqual([]);
  });

  it('when ember never answers, init completes within the request limit, with control', async () => {
    stubApi(rulesFile(), new Promise(() => {}));
    const flame = fresh();
    const begun = Date.now();
    await flame.init({ dsn: DSN, enableBatching: false, requestTimeoutMs: 50 });
    expect(Date.now() - begun).toBeLessThan(50 + 500);
    expect(flame.isInitialized()).toBe(true);
    expect(flame.getVariant(EXP)).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(records()).toEqual([]);
  });

  it('a rules file of an unknown version is not used', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubApi({ ...rulesFile(), version: 2 });
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    expect(flame.getVariant(EXP)).toBeNull();
  });
});

describe('a flame-edge answer', () => {
  const prehydrated = {
    user_id: 'edge-user',
    experiments: [
      {
        id: EXP,
        slug: 'hero-cta',
        project_id: 'p',
        name: 'Hero',
        description: null,
        status: 'running' as const,
        created_at: '',
        updated_at: '',
        variants: [
          { id: CONTROL, experiment_id: EXP, name: 'Control', is_control: true },
          { id: TREATMENT, experiment_id: EXP, name: 'Treatment', is_control: false },
        ],
      },
    ],
    assignments: {
      [EXP]: { experimentId: EXP, variantId: CONTROL, userId: 'edge-user', assignedAt: '' },
    },
  };

  it('is read at once, with no request, and recorded on read', async () => {
    localStorage.clear();
    stubApi();
    const flame = fresh();
    const init = flame.init({ dsn: DSN, enableBatching: false, prehydrated });
    expect(flame.getVariant('hero-cta')).toBe(CONTROL);
    await init;
    await vi.waitFor(() => expect(records()).toHaveLength(1));
    expect(records()[0].user_id).toBe('edge-user');
    expect(requests.filter((u) => !u.endsWith('/events'))).toEqual([]);
  });
});

describe('the page', () => {
  it('flame makes no change to it', async () => {
    document.body.innerHTML = '<h1 id="hero">Original</h1>';
    const changes: MutationRecord[] = [];
    const observer = new MutationObserver((records) => changes.push(...records));
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    stubApi();
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    flame.getVariant(EXP);
    flame.track('signup');
    await vi.waitFor(() => expect(records()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 10));
    changes.push(...observer.takeRecords());
    observer.disconnect();
    expect(changes).toEqual([]);
  });

  it('a click on an element an older flame marked as changed sends nothing', async () => {
    document.body.innerHTML =
      '<button id="cta" data-flame-modified="true" data-flame-selector="#cta">Buy</button>';
    stubApi();
    const flame = fresh();
    await flame.init({ dsn: DSN, enableBatching: false });
    flame.getVariant(EXP);
    document.getElementById('cta')!.click();
    flame.track('marker');
    await vi.waitFor(() => expect(sent.map((e) => e.event_type)).toContain('marker'));
    expect(sent.map((e) => e.event_type)).not.toContain('click');
  });
});
