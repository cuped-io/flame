import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { RulesFile } from './rules';

// flame#60: flame no longer listens to clicks and submits for goals, and
// e-commerce auto-detection is gone. A goal's event is fired by the page, with
// `flame.track()`; ember matches it by name. The pageview is still automatic.

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

// One arm with all the weight, so every visitor's pick is variant-A.
const rules: RulesFile = {
  version: 1,
  experiments: [
    {
      id: 'exp-1',
      slug: 'cta',
      url_pattern: null,
      variants: [{ id: 'variant-A', name: 'green', is_control: false, weight: 1 }],
    },
  ],
  holdout: null,
  promoted: [],
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
      if (url.endsWith('/rules')) {
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

  it('the initial pageview and track() still go out, track() carrying the arm the page read', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });
    flame.getVariant('cta');
    flame.track('cta_click', { source: 'hero' });
    await vi.waitFor(() => expect(types(sent)).toContain('cta_click'));

    const pageview = sent.find((e) => e.event_type === 'pageview');
    const goal = sent.find((e) => e.event_type === 'cta_click');
    // Sent at once, before any read: no arm yet (flame#24).
    expect(pageview?.experiment_assignments).toBeUndefined();
    expect(goal?.experiment_assignments).toEqual(ARM);
  });
});
