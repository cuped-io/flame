import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { RulesFile } from './rules';
import { clearIdentity } from './identity';

// flame#36: identify() replaced the TrackingManager without stopping the old
// one, so one visitor became two. clearIdentity() had the mirror bug: it
// never told the tracker, so events after logout still carried the
// logged-in user's ID.

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';
const EXP = '550e8400-e29b-41d4-a716-446655440001';

const rules: RulesFile = {
  version: 1,
  experiments: [
    {
      id: EXP,
      slug: 'cta',
      url_pattern: null,
      variants: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Control',
          is_control: true,
          weight: 1,
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          name: 'Treatment',
          is_control: false,
          weight: 1,
        },
      ],
    },
  ],
  holdout: null,
  promoted: [],
};

type SentEvent = { user_id: string; event_type: string };

/** `rulesGate`: `/rules` answers only once it resolves. */
function stubApi(rulesGate?: Promise<void>) {
  const sent: SentEvent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/rules')) {
        await rulesGate;
        return new Response(JSON.stringify(rules), { status: 200 });
      }
      if (url.includes('/events') && init?.body) {
        const body = JSON.parse(String(init.body));
        for (const e of body.events ?? [body]) sent.push(e);
      }
      return new Response('{}', { status: 200 });
    })
  );
  return sent;
}

const named = (sent: SentEvent[], type: string) => sent.filter((e) => e.event_type === type);

describe('identity switches keep one tracker (flame#36)', () => {
  let flame: Flame;
  afterEach(() => flame?.reset());

  beforeEach(() => {
    // The logged-in id is also kept in memory: forget the last test's.
    clearIdentity();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('after identify(), one track() is one event, under the new user ID', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });
    await flame.identify('user-42');

    flame.track('signup');
    await vi.waitFor(() => expect(named(sent, 'signup').length).toBeGreaterThan(0));

    expect(named(sent, 'signup')).toHaveLength(1);
    expect(named(sent, 'signup')[0].user_id).toBe('user-42');
  });

  it('after clearIdentity(), events go back to the device ID', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });
    await flame.identify('user-42');
    flame.clearIdentity();

    flame.track('signup');
    await vi.waitFor(() => expect(named(sent, 'signup').length).toBeGreaterThan(0));

    expect(named(sent, 'signup')).toHaveLength(1);
    expect(named(sent, 'signup')[0].user_id).not.toBe('user-42');
  });

  it('after identify(), the first read records the arm picked for the new user ID', async () => {
    // Golden vector: the device id user-1 lands on Control. sha256 puts
    // user-42 in bucket 1 of 2: Treatment.
    localStorage.setItem('flame_device_id', 'user-1');
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });
    await flame.identify('user-42');

    expect(flame.getVariant('cta')).toBe('22222222-2222-2222-2222-222222222222');
    await vi.waitFor(() => expect(named(sent, '$assignment')).toHaveLength(1));
    const record = named(sent, '$assignment')[0] as SentEvent & {
      metadata: { variant_id: string };
    };
    expect(record.user_id).toBe('user-42');
    expect(record.metadata.variant_id).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('identify() while init is picking from the stored copy: reads answer for the new user ID', async () => {
    // Golden vector: the device id user-1 lands on Control, user-42 on Treatment.
    localStorage.setItem('flame_device_id', 'user-1');
    localStorage.setItem('flame_rules_0123456789abcdef0123456789abcdef', JSON.stringify(rules));
    // The fresh copy never answers: only the stored one is picked from.
    stubApi(new Promise(() => {}));
    flame = new Flame();
    const init = flame.init({ dsn: DSN, enableBatching: false });
    await flame.identify('user-42');
    await init;

    expect(flame.getVariant('cta')).toBe('22222222-2222-2222-2222-222222222222');
  });
});
