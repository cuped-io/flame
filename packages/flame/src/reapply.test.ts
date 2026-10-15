import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { Experiment, Variant, VariantChange } from './types';
import { evaluateBody } from './test-evaluation';

// flame#45: flame applied only at init, so a target React re-created (a
// remount, client-side navigation away and back) lost its variant. flame now
// watches the page and applies to a target that appears without its
// data-flame-modified marker.

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

function experiment(changes: VariantChange[]): Experiment {
  return {
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
        changes,
      },
    ],
  };
}

const TEXT_CHANGE: VariantChange = {
  type: 'text',
  selector: '#headline',
  value: 'Variant headline',
};
const PROMOTED_WINNER = experiment([TEXT_CHANGE]).variants![0] as Variant;

function stubApi(exp: Experiment) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/experiments/active')) {
        return new Response(JSON.stringify({ experiments: [exp] }), { status: 200 });
      }
      if (url.endsWith('/evaluate')) {
        return new Response(
          evaluateBody({
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
/** What a framework does on a remount: a fresh element in the old one's place. */
function remount(id: string, text: string) {
  const fresh = document.createElement('h1');
  fresh.id = id;
  fresh.textContent = text;
  document.getElementById(id)!.replaceWith(fresh);
}

describe('re-apply on DOM change (flame#45)', () => {
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

  it('a target re-created fresh (a remount) gets its variant again', async () => {
    stubApi(experiment([TEXT_CHANGE]));
    flame = new Flame();
    await flame.init({ dsn: DSN });
    expect(headline()).toBe('Variant headline');

    remount('headline', 'Original');

    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
  });

  it('a target that appears later (client-side navigation into a view) gets its variant', async () => {
    document.body.innerHTML = '<div id="app"><p>Home</p></div>';
    stubApi(experiment([TEXT_CHANGE]));
    flame = new Flame();
    await flame.init({ dsn: DSN });

    document.getElementById('app')!.innerHTML = '<h1 id="headline">Original</h1>';

    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
  });

  it("re-applies only to the fresh target, leaving the site's own later change to a varied element alone", async () => {
    document.body.innerHTML = '<h1 id="headline">Original</h1><button id="cta">Buy</button>';
    stubApi(experiment([TEXT_CHANGE, { type: 'class', selector: '#cta', add: ['cta-variant'] }]));
    flame = new Flame();
    await flame.init({ dsn: DSN });
    expect(headline()).toBe('Variant headline');

    // The site updates the varied headline itself, then re-creates the button.
    document.getElementById('headline')!.textContent = 'Site update';
    const freshButton = document.createElement('button');
    freshButton.id = 'cta';
    freshButton.textContent = 'Buy';
    document.getElementById('cta')!.replaceWith(freshButton);

    await vi.waitFor(() =>
      expect(document.getElementById('cta')!.classList.contains('cta-variant')).toBe(true)
    );
    expect(headline()).toBe('Site update');
  });

  it("settles after re-applying: flame's own change does not trigger more work", async () => {
    stubApi(experiment([TEXT_CHANGE]));
    flame = new Flame();
    await flame.init({ dsn: DSN });
    remount('headline', 'Original');
    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));

    let laterMutations = 0;
    const counter = new MutationObserver((records) => (laterMutations += records.length));
    counter.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    await settle(300);
    counter.disconnect();

    expect(laterMutations).toBe(0);
  });

  it('stops re-applying, with a warning, when the site re-creates the element after every change', async () => {
    stubApi(experiment([TEXT_CHANGE]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    flame = new Flame();
    await flame.init({ dsn: DSN });

    // A site that fights: whenever the headline shows the variant, it
    // re-creates the element (on a timer, so this test can still measure).
    let recreations = 0;
    const fighter = new MutationObserver(() => {
      if (headline() === 'Variant headline') {
        setTimeout(() => {
          recreations++;
          remount('headline', 'Original');
        }, 1);
      }
    });
    fighter.observe(document.body, { childList: true, subtree: true });
    remount('headline', 'Original');
    await settle(1_000);
    const atOneSecond = recreations;
    await settle(300);
    fighter.disconnect();

    // Bounded: flame gave up, so the fight stopped.
    expect(recreations).toBe(atOneSecond);
    expect(recreations).toBeLessThan(50);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('#headline'));
  });

  it('never re-applies a redirect: after SPA navigation off its destination, a remount does not navigate', async () => {
    const start = new URL(window.location.href).pathname;
    window.history.pushState({}, '', '/pricing-v2');
    // jsdom cannot navigate; it reports an attempt as a "navigation" error.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      stubApi(experiment([{ type: 'redirect', url: '/pricing-v2' }, TEXT_CHANGE]));
      flame = new Flame();
      await flame.init({ dsn: DSN });
      // On the destination: no redirect (#37), the text change applies.
      expect(headline()).toBe('Variant headline');

      window.history.pushState({}, '', '/somewhere-else');
      remount('headline', 'Original');
      await vi.waitFor(() => expect(headline()).toBe('Variant headline'));

      const navigations = errors.mock.calls.filter((args) =>
        String(args[0]?.message ?? args[0]).includes('navigation')
      );
      expect(navigations).toHaveLength(0);
    } finally {
      window.history.pushState({}, '', start);
    }
  });

  it('consent(false) stops the watching: a later remount stays original', async () => {
    stubApi(experiment([TEXT_CHANGE]));
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });
    flame.consent(true);
    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));

    flame.consent(false);
    remount('headline', 'Original');
    await settle(200);

    expect(headline()).toBe('Original');
  });

  it('reset() stops the watching: a later remount stays original', async () => {
    stubApi(experiment([TEXT_CHANGE]));
    flame = new Flame();
    await flame.init({ dsn: DSN });
    expect(headline()).toBe('Variant headline');

    flame.reset();
    remount('headline', 'Original');
    await settle(200);

    expect(headline()).toBe('Original');
  });

  it('consent(false) stops re-applying a promoted winner too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/experiments/active')) {
          return new Response(
            JSON.stringify({
              experiments: [],
              promoted: [
                {
                  id: 'exp-p',
                  name: 'Promoted',
                  slug: 'promoted',
                  winner_promoted_at: '2026-10-10T12:00:00Z',
                  winner: { ...PROMOTED_WINNER, experiment_id: 'exp-p' },
                },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.endsWith('/evaluate')) {
          return new Response(
            evaluateBody({
              assignment_id: null,
              experiment_id: 'exp-p',
              variant_id: 'variant-A',
              variant_name: 'treatment',
              is_control: false,
              assigned_at: null,
            }),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 200 });
      })
    );
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });
    flame.consent(true);
    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));

    flame.consent(false);
    remount('headline', 'Original');
    await settle(200);

    expect(headline()).toBe('Original');
  });

  it('reapplyOnChange: false turns re-applying off', async () => {
    stubApi(experiment([TEXT_CHANGE]));
    flame = new Flame();
    await flame.init({ dsn: DSN, reapplyOnChange: false });
    expect(headline()).toBe('Variant headline');

    remount('headline', 'Original');
    await settle(200);

    expect(headline()).toBe('Original');
  });

  it('script tag: data-reapply="false" turns re-applying off', async () => {
    stubApi(experiment([TEXT_CHANGE]));
    const tag = document.createElement('script');
    tag.setAttribute('data-dsn', DSN);
    tag.setAttribute('data-reapply', 'false');
    document.head.appendChild(tag);
    vi.resetModules();
    const mod = await import('./index');
    flame = mod.flame as unknown as Flame;
    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
    tag.remove();

    remount('headline', 'Original');
    await settle(200);

    expect(headline()).toBe('Original');
  });
});
