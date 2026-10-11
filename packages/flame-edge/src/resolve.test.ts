import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveAssignments,
  readPrehydratedFromCookieHeader,
} from './resolve';
import { signPrehydrated, DEFAULT_COOKIE_NAME } from './cookie';
import type { Experiment, PrehydratedState, StoredAssignment } from '@cuped-io/flame';

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

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/', { headers });
}

function mockFetch(handlers: Array<(url: string, init?: RequestInit) => Response>) {
  let i = 0;
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
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

  it('cold-resolves when cookie is missing — fetches active + assigns', async () => {
    const assignment: StoredAssignment = {
      experimentId: 'exp-1',
      variantId: 'var-A',
      userId: 'will-be-overridden',
      assignedAt: '2024-01-01T00:00:00Z',
    };

    vi.stubGlobal(
      'fetch',
      mockFetch([
        // GET /experiments/active
        () =>
          new Response(JSON.stringify({ experiments: [exp1] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        // POST /experiments/exp-1/assign
        () =>
          new Response(
            JSON.stringify({
              assignment_id: 'a-1',
              experiment_id: assignment.experimentId,
              variant_id: assignment.variantId,
              variant_name: 'green',
              is_control: false,
              assigned_at: assignment.assignedAt,
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ),
      ])
    );

    const result = await resolveAssignments({
      dsn: DSN,
      request: makeRequest(),
      secret: SECRET,
      userId: 'edge-user-1',
    });

    expect(result.prehydrated).not.toBeNull();
    expect(result.prehydrated?.user_id).toBe('edge-user-1');
    expect(result.prehydrated?.experiments).toEqual([exp1]);
    expect(result.prehydrated?.assignments['exp-1'].variantId).toBe('var-A');
    expect(result.setCookie).toBeDefined();
    expect(result.setCookie).toMatch(new RegExp(`^${DEFAULT_COOKIE_NAME}=`));
  });

  it('cold-resolves when cookie is invalid (tampered)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        () => new Response(JSON.stringify({ experiments: [] }), { status: 200 }),
      ])
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

  it('survives a single failing assign without losing the rest', async () => {
    const exp2: Experiment = { ...exp1, id: 'exp-2', name: 'Pricing' };
    vi.stubGlobal(
      'fetch',
      mockFetch([
        () =>
          new Response(JSON.stringify({ experiments: [exp1, exp2] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        // exp-1 succeeds
        () =>
          new Response(
            JSON.stringify({
              assignment_id: 'a-1',
              experiment_id: 'exp-1',
              variant_id: 'var-A',
              variant_name: 'green',
              is_control: false,
              assigned_at: '2024-01-01T00:00:00Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ),
        // exp-2 fails
        () => new Response('boom', { status: 500 }),
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

  // ember answers 200 with null variant fields when the caller is in no
  // variant. For these users the original *is* the answer.
  const NO_VARIANT = {
    assignment_id: null,
    experiment_id: 'exp-1',
    variant_id: null,
    variant_name: null,
    is_control: null,
    assigned_at: null,
    held_out: false,
    cap_reached: false,
    workspace_archived: false,
  };

  it.each([
    ['held out', { ...NO_VARIANT, held_out: true }],
    ['cap reached', { ...NO_VARIANT, cap_reached: true }],
    ['workspace archived', { ...NO_VARIANT, workspace_archived: true }],
  ])('resolves %s to the original immediately, with no assignment', async (_arm, body) => {
    vi.stubGlobal(
      'fetch',
      mockFetch([
        () => new Response(JSON.stringify({ experiments: [exp1] }), { status: 200 }),
        () => new Response(JSON.stringify(body), { status: 200 }),
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

  const ASSIGNED = {
    assignment_id: 'a-1',
    experiment_id: 'exp-1',
    variant_id: 'var-A',
    variant_name: 'green',
    is_control: false,
    assigned_at: '2024-01-01T00:00:00Z',
    held_out: false,
    cap_reached: false,
    workspace_archived: false,
  };
  const REFUSED = {
    ...ASSIGNED,
    assignment_id: null,
    variant_id: null,
    variant_name: null,
    is_control: null,
    assigned_at: null,
  };
  const CAPPED = { ...REFUSED, cap_reached: true };
  const HELD_OUT = { ...REFUSED, held_out: true };

  const json = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

  function cookieFrom(setCookie: string | undefined): string {
    expect(setCookie).toBeDefined();
    return setCookie!.split(';')[0];
  }

  /** Cold-resolve one user whose assign answer is `assign`; return their cookie. */
  async function coldResolve(assign: unknown): Promise<string> {
    vi.stubGlobal('fetch', mockFetch([json({ experiments: [exp1] }), json(assign)]));
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

  it('asks again after the retry time and enrolls the same user', async () => {
    const cookie = await coldResolve(CAPPED);
    const fetchMock = mockFetch([json(ASSIGNED)]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveWith(cookie, T0 + RETRY_AFTER);

    // Only the refused experiment is asked about, not the active list.
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/experiments\/exp-1\/assign$/);
    expect(JSON.parse(String(init?.body))).toEqual({ user_id: 'edge-user-1' });

    expect(result.prehydrated?.user_id).toBe('edge-user-1');
    expect(result.prehydrated?.assignments['exp-1']?.variantId).toBe('var-A');

    // Enrolled now, so the new cookie has nothing left to retry.
    const later = vi.fn();
    vi.stubGlobal('fetch', later);
    await resolveWith(cookieFrom(result.setCookie), T0 + 10 * RETRY_AFTER);
    expect(later).not.toHaveBeenCalled();
  });

  it('pushes the retry time back when still refused', async () => {
    const cookie = await coldResolve(CAPPED);
    vi.stubGlobal('fetch', mockFetch([json(CAPPED)]));
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
