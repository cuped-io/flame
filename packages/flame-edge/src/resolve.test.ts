import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAssignments, readPrehydratedFromCookieHeader } from './resolve';
import { DEFAULT_COOKIE_NAME } from './cookie';
import type { RulesExperiment, RulesFile } from '@cuped-io/flame/rules';

const SECRET = 'test-secret-please-do-not-use';
const T0 = 1_700_000_000;

let projects = 0;
/** A DSN for a project no other test used, so each starts with no rules copy. */
function newDsn(): string {
  projects += 1;
  return `https://${projects.toString(16).padStart(32, '0')}@api.example.com`;
}

/** An experiment whose weights send every visitor to `treatment`. */
function experiment(id: string): RulesExperiment {
  return {
    id,
    slug: `slug-${id}`,
    url_pattern: null,
    variants: [
      { id: `${id}-control`, name: 'control', is_control: true, weight: 0 },
      { id: `${id}-treatment`, name: 'treatment', is_control: false, weight: 1 },
    ],
  };
}

function rulesFile(experiments: RulesExperiment[], extra: Partial<RulesFile> = {}): RulesFile {
  return { version: 1, experiments, holdout: null, promoted: [], ...extra };
}

/** fetch answering GET /rules with whatever `current()` returns. */
function serveRules(current: () => RulesFile) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith('/rules')) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(JSON.stringify(current()), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/', { headers });
}

function cookieFrom(setCookie: string | undefined): string {
  expect(setCookie).toBeDefined();
  return setCookie!.split(';')[0];
}

/** Resolves with background work collected, so a test can let it finish. */
function resolver(dsn: string) {
  const background: Promise<unknown>[] = [];
  const resolve = (opts: { cookie?: string; now?: number; userId?: string } = {}) =>
    resolveAssignments({
      dsn,
      secret: SECRET,
      request: makeRequest(opts.cookie ? { cookie: opts.cookie } : {}),
      now: opts.now ?? T0,
      userId: opts.userId,
      waitUntil: (p) => background.push(p),
    });
  const settle = async () => {
    await Promise.all(background.splice(0));
  };
  return { resolve, settle };
}

describe('resolveAssignments', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('picks a cookie-less visitor arms from the rules copy, with no call to ember', async () => {
    serveRules(() => rulesFile([experiment('exp-1')]));
    const edge = resolver(newDsn());
    await edge.resolve();
    await edge.settle();

    const fetchMock = serveRules(() => rulesFile([experiment('exp-1')]));
    const result = await edge.resolve({ userId: 'visitor-1', now: T0 + 1 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.prehydrated?.user_id).toBe('visitor-1');
    expect(result.prehydrated?.assignments['exp-1']?.variantId).toBe('exp-1-treatment');
    expect(cookieFrom(result.setCookie)).toMatch(new RegExp(`^${DEFAULT_COOKIE_NAME}=`));
  });
});

describe('resolveAssignments — a returning visitor', () => {
  const REFRESH = 60;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** A project whose ember serves `rules`, with a warm rules copy. */
  async function warmProject(rules: { current: RulesFile }) {
    serveRules(() => rules.current);
    const edge = resolver(newDsn());
    await edge.resolve();
    await edge.settle();
    return edge;
  }

  it('gets a newly started experiment and loses a stopped one within one refresh period', async () => {
    const rules = { current: rulesFile([experiment('exp-old')]) };
    const edge = await warmProject(rules);
    const first = await edge.resolve({ userId: 'visitor-1', now: T0 + 1 });
    const cookie = cookieFrom(first.setCookie);
    expect(Object.keys(first.prehydrated!.assignments)).toEqual(['exp-old']);

    // ember stops exp-old and starts exp-new.
    rules.current = rulesFile([experiment('exp-new')]);
    // The refresh starts in the background on the first request a period on.
    await edge.resolve({ cookie, now: T0 + REFRESH });
    await edge.settle();
    const later = await edge.resolve({ cookie, now: T0 + REFRESH + 1 });

    expect(later.prehydrated?.user_id).toBe('visitor-1');
    expect(later.prehydrated?.experiments.map((e) => e.id)).toEqual(['exp-new']);
    expect(Object.keys(later.prehydrated!.assignments)).toEqual(['exp-new']);
    expect(later.prehydrated?.assignments['exp-new']?.variantId).toBe('exp-new-treatment');

    // The new cookie carries the new arms.
    const next = await edge.resolve({ cookie: cookieFrom(later.setCookie), now: T0 + REFRESH + 2 });
    expect(next.setCookie).toBeUndefined();
    expect(next.prehydrated?.assignments['exp-new']?.variantId).toBe('exp-new-treatment');
  });

  it('serves the old copy, with no wait, until the refresh lands', async () => {
    const rules = { current: rulesFile([experiment('exp-old')]) };
    const edge = await warmProject(rules);
    rules.current = rulesFile([experiment('exp-new')]);

    const before = await edge.resolve({ userId: 'visitor-1', now: T0 + REFRESH - 1 });
    expect(before.prehydrated?.experiments.map((e) => e.id)).toEqual(['exp-old']);
  });
});

describe('resolveAssignments — the cookie', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stays under 1 KB with 20 running experiments', async () => {
    const experiments = Array.from({ length: 20 }, () => {
      const id = crypto.randomUUID();
      return {
        ...experiment(id),
        variants: [0, 1].map((i) => ({
          id: crypto.randomUUID(),
          name: `variant-${i}`,
          is_control: i === 0,
          weight: 1,
        })),
      };
    });
    serveRules(() => rulesFile(experiments));
    const edge = resolver(newDsn());
    await edge.resolve();
    await edge.settle();

    const result = await edge.resolve({ now: T0 + 1 });

    expect(Object.keys(result.prehydrated!.assignments)).toHaveLength(20);
    const cookie = cookieFrom(result.setCookie);
    expect(new TextEncoder().encode(cookie).length).toBeLessThan(1024);
  });

  it('keeps the arm a visitor has when the weights change', async () => {
    const rules = { current: rulesFile([experiment('exp-1')]) };
    serveRules(() => rules.current);
    const edge = resolver(newDsn());
    await edge.resolve();
    await edge.settle();
    const first = await edge.resolve({ userId: 'visitor-1', now: T0 + 1 });

    // Every new visitor now goes to control.
    const [control, treatment] = experiment('exp-1').variants;
    rules.current = rulesFile([
      { ...experiment('exp-1'), variants: [{ ...control, weight: 1 }, { ...treatment, weight: 0 }] },
    ]);
    await edge.resolve({ now: T0 + 60 });
    await edge.settle();

    const returning = await edge.resolve({ cookie: cookieFrom(first.setCookie), now: T0 + 61 });
    const fresh = await edge.resolve({ userId: 'visitor-2', now: T0 + 61 });

    expect(returning.prehydrated?.assignments['exp-1']?.variantId).toBe('exp-1-treatment');
    expect(returning.setCookie).toBeUndefined();
    expect(fresh.prehydrated?.assignments['exp-1']?.variantId).toBe('exp-1-control');
  });

  it('migrates a cookie signed before flame#62, keeping the visitor and the arm', async () => {
    serveRules(() => rulesFile([experiment('exp-1')]));
    const edge = resolver(newDsn());
    await edge.resolve();
    await edge.settle();
    // A v1 cookie as flame-edge 0.5 signed it: the whole state in the payload.
    const payload = {
      v: 1,
      iat: T0,
      exp: T0 + 3600,
      state: {
        user_id: 'old-visitor',
        user_id_created_at: '2023-11-14T22:13:20.000Z',
        experiments: [],
        assignments: {
          'exp-1': {
            experimentId: 'exp-1',
            variantId: 'exp-1-control',
            userId: 'old-visitor',
            assignedAt: '2023-11-14T22:13:20.000Z',
          },
        },
      },
    };
    const cookie = `${DEFAULT_COOKIE_NAME}=${await signV1(payload)}`;

    const result = await edge.resolve({ cookie, now: T0 + 1 });

    expect(result.prehydrated?.user_id).toBe('old-visitor');
    expect(result.prehydrated?.user_id_created_at).toBe('2023-11-14T22:13:20.000Z');
    expect(result.prehydrated?.assignments['exp-1']?.variantId).toBe('exp-1-control');
    // Re-signed in the new shape, which the next request reads unchanged.
    const next = await edge.resolve({ cookie: cookieFrom(result.setCookie), now: T0 + 2 });
    expect(next.setCookie).toBeUndefined();
    expect(next.prehydrated?.assignments['exp-1']?.variantId).toBe('exp-1-control');
  });

  it('rejects a tampered cookie and treats the request as a new visitor', async () => {
    serveRules(() => rulesFile([experiment('exp-1')]));
    const edge = resolver(newDsn());
    await edge.resolve();
    await edge.settle();

    const result = await edge.resolve({
      cookie: `${DEFAULT_COOKIE_NAME}=garbage.signature`,
      userId: 'visitor-new',
      now: T0 + 1,
    });

    expect(result.prehydrated?.user_id).toBe('visitor-new');
    expect(result.setCookie).toBeDefined();
  });
});

describe('resolveAssignments — no rules copy yet', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('answers at once with no arms when ember is unreachable', async () => {
    // A fetch that never settles: a request that waited on it would hang.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const result = await resolveAssignments({
      dsn: newDsn(),
      request: makeRequest(),
      secret: SECRET,
    });
    expect(result).toEqual({ prehydrated: null });
  });

  it('keeps the visitor cookie as it is', async () => {
    const dsn = newDsn();
    serveRules(() => rulesFile([experiment('exp-1')]));
    const warm = resolver(dsn);
    await warm.resolve();
    await warm.settle();
    const signed = await warm.resolve({ userId: 'visitor-1', now: T0 + 1 });

    // Another project's runtime that has no copy: a cookie for it is kept.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('econnrefused')))
    );
    const result = await resolver(newDsn()).resolve({ cookie: cookieFrom(signed.setCookie) });
    expect(result).toEqual({ prehydrated: null });
  });

  it('starts using the copy once the background fetch lands', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('econnrefused')))
    );
    const edge = resolver(newDsn());
    await edge.resolve();
    await edge.settle();
    // ember is back; the failed fetch waits one period before the next.
    serveRules(() => rulesFile([experiment('exp-1')]));
    expect((await edge.resolve({ now: T0 + 59 })).prehydrated).toBeNull();
    await edge.resolve({ now: T0 + 60 });
    await edge.settle();

    const result = await edge.resolve({ userId: 'visitor-1', now: T0 + 61 });
    expect(result.prehydrated?.assignments['exp-1']?.variantId).toBe('exp-1-treatment');
  });
});

describe('resolveAssignments — the Holdout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('leaves a held-out visitor with no arms, and keeps them out', async () => {
    const all = { id: 'holdout-1', percentage: 100, active: true };
    serveRules(() => rulesFile([experiment('exp-1')], { holdout: all }));
    const edge = resolver(newDsn());
    await edge.resolve();
    await edge.settle();

    const first = await edge.resolve({ userId: 'visitor-1', now: T0 + 1 });
    expect(first.prehydrated?.experiments.map((e) => e.id)).toEqual(['exp-1']);
    expect(first.prehydrated?.assignments).toEqual({});

    const again = await edge.resolve({ cookie: cookieFrom(first.setCookie), now: T0 + 2 });
    expect(again.prehydrated?.user_id).toBe('visitor-1');
    expect(again.prehydrated?.assignments).toEqual({});
  });
});

describe('readPrehydratedFromCookieHeader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('gives the state the middleware signed, from the rules copy', async () => {
    const dsn = newDsn();
    serveRules(() => rulesFile([experiment('exp-1')]));
    const edge = resolver(dsn);
    await edge.resolve();
    await edge.settle();
    const signed = await edge.resolve({ userId: 'visitor-1', now: T0 + 1 });

    const fetchMock = serveRules(() => rulesFile([experiment('exp-1')]));
    const state = await readPrehydratedFromCookieHeader(
      `other=1; ${cookieFrom(signed.setCookie)}`,
      { dsn, secret: SECRET, now: T0 + 1 }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state).toEqual(signed.prehydrated);
  });

  it('returns null for a missing cookie', async () => {
    serveRules(() => rulesFile([experiment('exp-1')]));
    expect(await readPrehydratedFromCookieHeader(null, { dsn: newDsn(), secret: SECRET })).toBeNull();
    expect(
      await readPrehydratedFromCookieHeader('other=value', { dsn: newDsn(), secret: SECRET })
    ).toBeNull();
  });

  it('returns null, with no wait, when this runtime has no rules copy', async () => {
    const dsn = newDsn();
    serveRules(() => rulesFile([experiment('exp-1')]));
    const edge = resolver(dsn);
    await edge.resolve();
    await edge.settle();
    const signed = await edge.resolve({ userId: 'visitor-1', now: T0 + 1 });

    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {}))
    );
    const state = await readPrehydratedFromCookieHeader(cookieFrom(signed.setCookie), {
      dsn: newDsn(),
      secret: SECRET,
    });
    expect(state).toBeNull();
  });
});

/** Sign a payload as flame-edge did before flame#62. */
async function signV1(payload: unknown): Promise<string> {
  const b64 = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, json));
  return `${b64(json)}.${b64(sig)}`;
}
