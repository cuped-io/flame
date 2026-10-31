import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { Experiment } from './types';
import { evaluateBody } from './test-evaluation';

// flame#60: flame no longer listens to clicks and submits for goals, and
// e-commerce auto-detection is gone. A goal's event is fired by the page, with
// `flame.track()`; ember matches it by name. The pageview is still automatic.

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

const experiment: Experiment = {
  id: 'exp-1',
  project_id: 'proj-1',
  name: 'CTA',
  description: null,
  status: 'running',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  goals: [
    { name: 'cta_click', type: 'click', selector: '#cta' },
    { name: 'signup', type: 'submit', selector: '#signup' },
    { name: 'any_form', type: 'submit' },
    { name: 'checkout_view', type: 'pageview', url_pattern: '/checkout' },
    { name: 'vote_cast', type: 'custom' },
  ],
  variants: [
    {
      id: 'variant-A',
      experiment_id: 'exp-1',
      name: 'green',
      description: null,
      is_control: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      changes: [],
    },
  ],
};

type SentEvent = {
  event_type: string;
  experiment_assignments?: { experiment_id: string; variant_id: string }[];
};

function stubApi() {
  const sent: SentEvent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/experiments/active')) {
        return new Response(JSON.stringify({ experiments: [experiment] }), { status: 200 });
      }
      if (url.endsWith('/evaluate')) {
        return new Response(
          evaluateBody({
            assignment_id: null,
            experiment_id: 'exp-1',
            variant_id: 'variant-A',
            variant_name: 'green',
            is_control: false,
            assigned_at: null,
            resolution: 'assigned',
          }),
          { status: 200 }
        );
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

const types = (sent: SentEvent[]) => sent.map((e) => e.event_type);
const ARM = [{ experiment_id: 'exp-1', variant_id: 'variant-A' }];

describe('goals are fired by the page, not by DOM listeners (flame#60)', () => {
  let flame: Flame;
  afterEach(() => flame?.reset());

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // Matches the old built-in e-commerce selectors too (`.add-to-cart`).
    document.body.innerHTML = `
      <button id="cta" class="add-to-cart">Add to cart</button>
      <form id="signup" onsubmit="return false"><button type="submit">Sign up</button></form>`;
  });

  it('a click or a form submit sends no goal event, for any goal type', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });
    await vi.waitFor(() => expect(types(sent)).toContain('pageview'));
    const before = sent.length;

    document.getElementById('cta')!.click();
    document.querySelector<HTMLButtonElement>('#signup button')!.click();
    flame.track('marker');
    await vi.waitFor(() => expect(types(sent)).toContain('marker'));

    expect(types(sent.slice(before))).toEqual(['marker']);
  });

  it('a leftover autoEcommerce option switches nothing on', async () => {
    const sent = stubApi();
    flame = new Flame();
    // Plain JS callers can still pass the removed option.
    await flame.init({ dsn: DSN, enableBatching: false, autoEcommerce: true } as never);
    await vi.waitFor(() => expect(types(sent)).toContain('pageview'));
    const before = sent.length;

    document.getElementById('cta')!.click();
    flame.track('marker');
    await vi.waitFor(() => expect(types(sent)).toContain('marker'));

    expect(types(sent.slice(before))).toEqual(['marker']);
  });

  it('the initial pageview and track() still go out, carrying the recorded arm', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });
    flame.track('cta_click', { source: 'hero' });
    await vi.waitFor(() => expect(types(sent)).toContain('cta_click'));

    const pageview = sent.find((e) => e.event_type === 'pageview');
    const goal = sent.find((e) => e.event_type === 'cta_click');
    expect(pageview?.experiment_assignments).toEqual(ARM);
    expect(goal?.experiment_assignments).toEqual(ARM);
  });
});
