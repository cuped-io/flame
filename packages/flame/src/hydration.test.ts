import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { Experiment } from './types';

// flame#44: on a server-rendered React page, applying a variant before React
// hydrates makes React throw #418 (hydration mismatch) and discard it. flame
// now waits until React has taken over the element. React marks a hydrated
// element with an own `__reactFiber$<random>` key; setting that key is how
// these tests stand in for React.

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

const experiment: Experiment = {
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
      id: 'variant-A',
      experiment_id: 'exp-1',
      name: 'treatment',
      description: null,
      is_control: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      changes: [{ type: 'text', selector: '#headline', value: 'Variant headline' }],
    },
  ],
};

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/experiments/active')) {
        return new Response(JSON.stringify({ experiments: [experiment] }), { status: 200 });
      }
      if (url.endsWith('/experiments/exp-1/assign')) {
        return new Response(
          JSON.stringify({
            assignment_id: 'a1',
            experiment_id: 'exp-1',
            variant_id: 'variant-A',
            variant_name: 'treatment',
            is_control: false,
            assigned_at: '2024-01-01T00:00:00Z',
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    })
  );
}

const headline = () => document.getElementById('headline')?.textContent;
const settle = (ms = 100) => new Promise((r) => setTimeout(r, ms));
/** What React does to an element it has hydrated. */
const hydrate = (id: string) => {
  (document.getElementById(id) as unknown as Record<string, unknown>)['__reactFiber$x1y2'] = {};
};

describe('hydration-aware apply (flame#44)', () => {
  let flame: Flame;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '<h1 id="headline">Original</h1>';
  });

  afterEach(() => {
    flame?.reset();
  });

  it('with waitForHydration, leaves an element alone until React has hydrated it, then applies', async () => {
    stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, waitForHydration: true });
    await settle();
    expect(headline()).toBe('Original');

    hydrate('headline');
    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
  });

  it('waits automatically on a Next.js page (its __next_f marker), with no opt-in', async () => {
    stubApi();
    (globalThis as unknown as { __next_f?: unknown[] }).__next_f = [];
    try {
      flame = new Flame();
      await flame.init({ dsn: DSN });
      await settle();
      expect(headline()).toBe('Original');

      hydrate('headline');
      await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
    } finally {
      delete (globalThis as unknown as { __next_f?: unknown[] }).__next_f;
    }
  });

  it.each([
    [
      'Next.js pages router (#__NEXT_DATA__)',
      () => {
        const el = document.createElement('script');
        el.id = '__NEXT_DATA__';
        document.body.appendChild(el);
      },
    ],
    [
      'Remix (window.__remixContext)',
      () => {
        (window as unknown as Record<string, unknown>).__remixContext = {};
      },
    ],
    [
      'React Router 7 (window.__reactRouterContext)',
      () => {
        (window as unknown as Record<string, unknown>).__reactRouterContext = {};
      },
    ],
    [
      'Gatsby (#___gatsby)',
      () => {
        const el = document.createElement('div');
        el.id = '___gatsby';
        document.body.appendChild(el);
      },
    ],
  ])('waits automatically on %s', async (_name, addMarker) => {
    stubApi();
    addMarker();
    try {
      flame = new Flame();
      await flame.init({ dsn: DSN });
      await settle();
      expect(headline()).toBe('Original');

      hydrate('headline');
      await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
    } finally {
      delete (window as unknown as Record<string, unknown>).__remixContext;
      delete (window as unknown as Record<string, unknown>).__reactRouterContext;
    }
  });

  it('with no framework marker and no opt-in, applies immediately, as before', async () => {
    stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN });

    expect(headline()).toBe('Variant headline');
  });

  it('waitForHydration: false applies immediately even on a detected framework', async () => {
    stubApi();
    (globalThis as unknown as { __next_f?: unknown[] }).__next_f = [];
    try {
      flame = new Flame();
      await flame.init({ dsn: DSN, waitForHydration: false });

      expect(headline()).toBe('Variant headline');
    } finally {
      delete (globalThis as unknown as { __next_f?: unknown[] }).__next_f;
    }
  });

  it(
    'if React never hydrates the element, applies anyway after 5 seconds',
    { timeout: 10_000 },
    async () => {
      stubApi();
      flame = new Flame();
      await flame.init({ dsn: DSN, waitForHydration: true });
      await settle(4_500);
      expect(headline()).toBe('Original');

      await vi.waitFor(() => expect(headline()).toBe('Variant headline'), { timeout: 2_000 });
    }
  );

  it('with anti-flicker, the page stays hidden while waiting and is revealed once, after applying', async () => {
    stubApi();
    const af = { revealed: false, reveal: vi.fn(() => (af.revealed = true)) };
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = af;
    try {
      flame = new Flame();
      await flame.init({ dsn: DSN, waitForHydration: true });
      await settle();
      expect(af.reveal).not.toHaveBeenCalled();

      hydrate('headline');
      await vi.waitFor(() => expect(af.reveal).toHaveBeenCalledTimes(1));
      expect(headline()).toBe('Variant headline');
    } finally {
      delete (window as unknown as { __cupedAntiflicker?: unknown }).__cupedAntiflicker;
    }
  });
});
