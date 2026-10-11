import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { Experiment } from './types';

// flame#36: identify() replaced the TrackingManager without stopping the old
// one. The old click/submit listeners kept firing under the device ID, the
// new manager never started auto-tracking, and the e-commerce goals were not
// re-registered. clearIdentity() had the mirror bug: it never told the
// tracker, so events after logout still carried the logged-in user's ID.

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

const experiment: Experiment = {
  id: 'exp-1',
  project_id: 'proj-1',
  name: 'CTA',
  description: null,
  status: 'running',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  goals: [{ name: 'cta_click', type: 'click', selector: '#cta' }],
  variants: [],
};

type SentEvent = { user_id: string; event_type: string };

function stubApi() {
  const sent: SentEvent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/experiments/active')) {
        return new Response(JSON.stringify({ experiments: [experiment] }), { status: 200 });
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

const clicks = (sent: SentEvent[]) => sent.filter((e) => e.event_type === 'cta_click');

describe('identity switches keep one tracker (flame#36)', () => {
  // Each test's instance listens on the shared document; stop it after.
  let flame: Flame;
  afterEach(() => flame?.reset());

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.body.innerHTML = '<button id="cta">Buy</button>';
  });

  it('after identify(), one click is one goal event, under the new user ID', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });
    await flame.identify('user-42');

    document.getElementById('cta')!.click();
    await vi.waitFor(() => expect(clicks(sent).length).toBeGreaterThan(0));

    expect(clicks(sent)).toHaveLength(1);
    expect(clicks(sent)[0].user_id).toBe('user-42');
  });

  it('after clearIdentity(), events go back to the device ID', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });
    await flame.identify('user-42');
    flame.clearIdentity();

    document.getElementById('cta')!.click();
    await vi.waitFor(() => expect(clicks(sent).length).toBeGreaterThan(0));

    expect(clicks(sent)).toHaveLength(1);
    expect(clicks(sent)[0].user_id).not.toBe('user-42');
  });
});
