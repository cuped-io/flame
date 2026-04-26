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
