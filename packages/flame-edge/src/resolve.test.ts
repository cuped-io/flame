import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveAssignments, readPrehydratedFromCookieHeader } from './resolve';
import { signPrehydrated, DEFAULT_COOKIE_NAME } from './cookie';
import type { Experiment, PrehydratedState } from '@cuped-io/flame';

const SECRET = 'test-secret-please-do-not-use';
const DSN = 'https://0123456789abcdef0123456789abcdef@api.example.com';

const exp1: Experiment = {
  id: 'exp-1',
  project_id: 'proj-1',
  name: 'Hero',
  description: null,
  status: 'running',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  goals: [],
  variants: [
    {
      id: 'var-A',
      experiment_id: 'exp-1',
      name: 'green',
      description: null,
      is_control: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ],
};

/** ember's `/evaluate` answer putting the visitor in exp-1's var-A. */
const ARM_A = {
  experiment_id: 'exp-1',
  variant_id: 'var-A',
  variant_name: 'green',
  is_control: false,
  resolution: 'assigned',
};

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/', { headers });
}

function mockFetch(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  let i = 0;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const handler = handlers[i++];
    if (!handler) throw new Error(`Unexpected fetch ${i}: ${url}`);
    return handler(url, init);
  });
}

describe('resolveAssignments', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the cookie payload when valid', async () => {
    const state: PrehydratedState = {
      user_id: 'cached-user',
      experiments: [exp1],
      assignments: {
        'exp-1': {
          experimentId: 'exp-1',
          variantId: 'var-A',
          userId: 'cached-user',
          assignedAt: '2024-01-01T00:00:00Z',
        },
      },
    };
    const cookie = await signPrehydrated(state, SECRET);
    const request = makeRequest({ cookie: `${DEFAULT_COOKIE_NAME}=${cookie}` });

    const fetchMock = vi.fn(); // should not be called
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveAssignments({ dsn: DSN, request, secret: SECRET });

    expect(result.prehydrated).toEqual(state);
    expect(result.setCookie).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cold-resolves when cookie is missing: one /evaluate, never /assign', async () => {
    const fetchMock = mockFetch([
      // GET /experiments/active
      () =>
        new Response(JSON.stringify({ experiments: [exp1] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      // POST /evaluate
      () =>
        new Response(JSON.stringify({ evaluations: [ARM_A] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveAssignments({
      dsn: DSN,
      request: makeRequest(),
      secret: SECRET,
      userId: 'edge-user-1',
    });

    // Evaluation writes no assignment: the page that delivers the arm records it.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toBe('https://api.example.com/0123456789abcdef0123456789abcdef/evaluate');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ user_id: 'edge-user-1' });
    expect(result.prehydrated?.user_id).toBe('edge-user-1');
    expect(result.prehydrated?.experiments).toEqual([exp1]);
    expect(result.prehydrated?.assignments['exp-1'].variantId).toBe('var-A');
    expect(result.prehydrated?.assignments['exp-1'].userId).toBe('edge-user-1');
    expect(result.setCookie).toBeDefined();
    expect(result.setCookie).toMatch(new RegExp(`^${DEFAULT_COOKIE_NAME}=`));
  });

  it('cold-resolves when cookie is invalid (tampered)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([() => new Response(JSON.stringify({ experiments: [] }), { status: 200 })])
    );
    const result = await resolveAssignments({
      dsn: DSN,
      request: makeRequest({ cookie: `${DEFAULT_COOKIE_NAME}=garbage.signature` }),
      secret: SECRET,
    });
    expect(result.prehydrated?.experiments).toEqual([]);
    expect(result.setCookie).toBeDefined();
  });

  it('falls through to client-side init when the cuped API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('econnrefused')))
    );
    const result = await resolveAssignments({
      dsn: DSN,
      request: makeRequest(),
      secret: SECRET,
    });
    expect(result.prehydrated).toBeNull();
    expect(result.setCookie).toBeUndefined();
  });

  it.each([
    ['fails', () => new Response('boom', { status: 500 })],
    ['answers with no evaluations list', () => new Response('{}', { status: 200 })],
  ])('falls through to client-side init when /evaluate %s', async (_case, evaluate) => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        () => new Response(JSON.stringify({ experiments: [exp1] }), { status: 200 }),
        evaluate,
      ])
    );
    const result = await resolveAssignments({ dsn: DSN, request: makeRequest(), secret: SECRET });
    expect(result.prehydrated).toBeNull();
    expect(result.setCookie).toBeUndefined();
  });

  it('keeps the arms ember gave when it leaves an experiment out of its answer', async () => {
    const exp2: Experiment = { ...exp1, id: 'exp-2', name: 'Pricing' };
    vi.stubGlobal(
      'fetch',
      mockFetch([
        () => new Response(JSON.stringify({ experiments: [exp1, exp2] }), { status: 200 }),
        () => new Response(JSON.stringify({ evaluations: [ARM_A] }), { status: 200 }),
      ])
    );

    const result = await resolveAssignments({
      dsn: DSN,
      request: makeRequest(),
      secret: SECRET,
      userId: 'edge-user-1',
    });

    // Both experiments listed, but only exp-1 has an assignment.
    expect(result.prehydrated?.experiments.map((e) => e.id)).toEqual(['exp-1', 'exp-2']);
    expect(Object.keys(result.prehydrated?.assignments ?? {})).toEqual(['exp-1']);
  });

  // ember answers with null variant fields when the caller is in no
  // variant. For these users the original *is* the answer.
  const NO_VARIANT = {
    experiment_id: 'exp-1',
    variant_id: null,
    variant_name: null,
    is_control: null,
  };

  it.each([
    ['held out', { ...NO_VARIANT, resolution: 'held_out' }],
    ['cap reached', { ...NO_VARIANT, resolution: 'cap_reached' }],
    ['workspace archived', { ...NO_VARIANT, resolution: 'workspace_archived' }],
  ])('resolves %s to the original immediately, with no assignment', async (_arm, answer) => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        () => new Response(JSON.stringify({ experiments: [exp1] }), { status: 200 }),
        () => new Response(JSON.stringify({ evaluations: [answer] }), { status: 200 }),
      ])
    );

    const started = Date.now();
    const result = await resolveAssignments({
      dsn: DSN,
      request: makeRequest(),
      secret: SECRET,
      userId: 'edge-user-1',
      // Far longer than the test may take: resolving must not wait on it.
      timeoutMs: 60_000,
    });

    expect(Date.now() - started).toBeLessThan(1_000);
    // A resolved answer, not the `null` fallback that hands off to the client.
    expect(result.prehydrated).not.toBeNull();
    expect(result.prehydrated?.experiments).toEqual([exp1]);
    expect(result.prehydrated?.assignments).toEqual({});
    expect(result.setCookie).toBeDefined();
  });
});

describe('resolveAssignments — retrying refusals that can lift', () => {
  // A cap or an archive lifts (upgrade, billing reset, revive); a Holdout
  // doesn't. So a capped/archived refusal is asked again after a while,
  // a held-out one never is.
  const T0 = 1_700_000_000;
  const RETRY_AFTER = 10 * 60;

  const ASSIGNED = ARM_A;
  const REFUSED = {
    ...ASSIGNED,
    variant_id: null,
    variant_name: null,
    is_control: null,
  };
  const CAPPED = { ...REFUSED, resolution: 'cap_reached' };
  const HELD_OUT = { ...REFUSED, resolution: 'held_out' };

  const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
  /** An `/evaluate` response carrying these answers. */
  const evaluated = (...answers: unknown[]) => json({ evaluations: answers });

  function cookieFrom(setCookie: string | undefined): string {
    expect(setCookie).toBeDefined();
    return setCookie!.split(';')[0];
  }

  /** Cold-resolve one user whose `/evaluate` answers are `answers`; return their cookie. */
  async function coldResolve(...answers: unknown[]): Promise<string> {
    vi.stubGlobal('fetch', mockFetch([json({ experiments: [exp1] }), evaluated(...answers)]));
    const result = await resolveAssignments({
      dsn: DSN,
      request: makeRequest(),
      secret: SECRET,
      userId: 'edge-user-1',
      now: T0,
    });
    return cookieFrom(result.setCookie);
  }

  function resolveWith(cookie: string, now: number) {
    return resolveAssignments({
      dsn: DSN,
      request: makeRequest({ cookie }),
      secret: SECRET,
      now,
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not ask again before the retry time', async () => {
    const cookie = await coldResolve(CAPPED);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveWith(cookie, T0 + RETRY_AFTER - 1);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.prehydrated?.assignments).toEqual({});
    expect(result.setCookie).toBeUndefined();
  });

  it('evaluates the same user again after the retry time', async () => {
    const cookie = await coldResolve(CAPPED);
    const fetchMock = mockFetch([evaluated(ASSIGNED)]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveWith(cookie, T0 + RETRY_AFTER);

    // One /evaluate, not the active list, and never /assign.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/evaluate$/);
    expect(JSON.parse(String(init?.body))).toEqual({ user_id: 'edge-user-1' });

    expect(result.prehydrated?.user_id).toBe('edge-user-1');
    expect(result.prehydrated?.assignments['exp-1']?.variantId).toBe('var-A');

    // Has an arm now, so the new cookie has nothing left to retry.
    const later = vi.fn();
    vi.stubGlobal('fetch', later);
    await resolveWith(cookieFrom(result.setCookie), T0 + 10 * RETRY_AFTER);
    expect(later).not.toHaveBeenCalled();
  });

  it('a retry changes only the experiments it was due for', async () => {
    const exp2: Experiment = { ...exp1, id: 'exp-2', name: 'Pricing' };
    vi.stubGlobal(
      'fetch',
      mockFetch([
        json({ experiments: [exp1, exp2] }),
        evaluated(ASSIGNED, { ...CAPPED, experiment_id: 'exp-2' }),
      ])
    );
    const cold = await resolveAssignments({
      dsn: DSN,
      request: makeRequest(),
      secret: SECRET,
      userId: 'edge-user-1',
      now: T0,
    });

    vi.stubGlobal(
      'fetch',
      mockFetch([
        evaluated(
          { ...ASSIGNED, variant_id: 'var-B' },
          { ...ASSIGNED, experiment_id: 'exp-2', variant_id: 'var-2' }
        ),
      ])
    );
    const result = await resolveWith(cookieFrom(cold.setCookie), T0 + RETRY_AFTER);

    // The arm the visitor already has stays, so their page does not change.
    expect(result.prehydrated?.assignments['exp-1']?.variantId).toBe('var-A');
    expect(result.prehydrated?.assignments['exp-2']?.variantId).toBe('var-2');
  });

  it('pushes the retry time back when still refused', async () => {
    const cookie = await coldResolve(CAPPED);
    vi.stubGlobal('fetch', mockFetch([evaluated(CAPPED)]));
    const retried = await resolveWith(cookie, T0 + RETRY_AFTER);
    expect(retried.prehydrated?.assignments).toEqual({});

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await resolveWith(cookieFrom(retried.setCookie), T0 + 2 * RETRY_AFTER - 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps serving the cookie when the retry fails, and backs off', async () => {
    const cookie = await coldResolve(CAPPED);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('econnrefused')))
    );

    const result = await resolveWith(cookie, T0 + RETRY_AFTER);

    expect(result.prehydrated?.user_id).toBe('edge-user-1');
    expect(result.prehydrated?.experiments).toEqual([exp1]);
    expect(result.prehydrated?.assignments).toEqual({});

    // With the API down, the next request must not pay another timeout.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await resolveWith(cookieFrom(result.setCookie), T0 + 2 * RETRY_AFTER - 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks again later when an older cuped API sends no resolution', async () => {
    const older = { ...ASSIGNED, resolution: undefined };
    const cookie = await coldResolve(older);
    const fetchMock = mockFetch([evaluated(ASSIGNED)]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveWith(cookie, T0 + RETRY_AFTER);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.prehydrated?.assignments['exp-1']?.variantId).toBe('var-A');
  });

  it('never asks again for a held-out user', async () => {
    const cookie = await coldResolve(HELD_OUT);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveWith(cookie, T0 + 100 * RETRY_AFTER);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.prehydrated?.assignments).toEqual({});
  });
});

describe('readPrehydratedFromCookieHeader', () => {
  it('returns null for missing cookie', async () => {
    expect(await readPrehydratedFromCookieHeader(null, SECRET)).toBeNull();
    expect(await readPrehydratedFromCookieHeader('other=value', SECRET)).toBeNull();
  });

  it('returns the state for a valid cookie', async () => {
    const state: PrehydratedState = {
      user_id: 'u',
      experiments: [],
      assignments: {},
    };
    const cookie = await signPrehydrated(state, SECRET);
    const header = `${DEFAULT_COOKIE_NAME}=${cookie}`;
    expect(await readPrehydratedFromCookieHeader(header, SECRET)).toEqual(state);
  });
});
