import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';

// flame#38: e-commerce auto-detection ran on every site, with selectors broad
// enough to match an address form's "add" button, and every match is a
// billable event. It is now opt-in: `autoEcommerce: true`, or
// `data-ecommerce="true"` on the script tag.

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

type SentEvent = { event_type: string };

function stubApi() {
  const sent: SentEvent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/experiments/active')) {
        return new Response(JSON.stringify({ experiments: [] }), { status: 200 });
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

const addToCart = (sent: SentEvent[]) => sent.filter((e) => e.event_type === 'add_to_cart');

describe('e-commerce auto-goals are opt-in (flame#38)', () => {
  let flame: Flame;
  afterEach(() => flame?.reset());

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // A non-shop page: an address form's "add" button matches the old
    // `button[name*='add']` selector.
    document.body.innerHTML = '<button name="add-address">Add address</button>';
  });

  it('by default, a matching click fires no e-commerce event', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false });

    document.querySelector('button')!.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(addToCart(sent)).toHaveLength(0);
  });

  it('with autoEcommerce: true, the same click fires add_to_cart', async () => {
    const sent = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, enableBatching: false, autoEcommerce: true });

    document.querySelector('button')!.click();
    await vi.waitFor(() => expect(addToCart(sent)).toHaveLength(1));
  });
});
