/**
 * The early answer (flame#65): a returning visitor's saved arm is on
 * flame-react's first render that is not a hydration, before flame is
 * ready. A hydration matches the server render, which cannot see it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { render, act, waitFor } from '@testing-library/react';
import { Flame } from '@cuped-io/flame';
import { CupedProvider } from './provider';
import { useExperiment } from './useExperiment';

const API_KEY = '0123456789abcdef0123456789abcdef';
const DSN = `https://${API_KEY}@api.example.com`;
const HERO = '550e8400-e29b-41d4-a716-446655440001';
const TREATMENT = '22222222-2222-2222-2222-222222222222';

// Golden vectors: user-1 with weights control 1 / treatment 3 lands on treatment.
const rules = {
  version: 1,
  experiments: [
    {
      id: HERO,
      slug: 'hero-cta',
      url_pattern: null,
      variants: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Control',
          is_control: true,
          weight: 1,
        },
        { id: TREATMENT, name: 'Treatment', is_control: false, weight: 3 },
      ],
    },
    {
      id: '550e8400-e29b-41d4-a716-446655440002',
      slug: 'pricing',
      url_pattern: null,
      variants: [
        { id: '44444444-4444-4444-4444-444444444444', name: 'Old', is_control: true, weight: 1 },
        { id: '55555555-5555-5555-5555-555555555555', name: 'New', is_control: false, weight: 1 },
      ],
    },
  ],
  holdout: null,
  promoted: [],
};

/** The `$assignment` records ember received, by experiment id. */
let recorded: string[] = [];

/** ember: `/rules` answers once `answer` says so, and events are taken. */
function stubEmber(answer: Promise<void>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/events')) {
        const events = JSON.parse(String(init?.body)).events as {
          event_type: string;
          metadata: { experiment_id: string };
        }[];
        for (const e of events) {
          if (e.event_type === '$assignment') recorded.push(e.metadata.experiment_id);
        }
        return new Response(null, { status: 204 });
      }
      await answer;
      return new Response(JSON.stringify(rules), { status: 200 });
    })
  );
}

/** A first visit that reads only hero-cta, and records it: the returning visitor's state. */
async function firstVisit() {
  stubEmber(Promise.resolve());
  const flame = new Flame();
  await flame.init({ dsn: DSN, enableBatching: false });
  flame.getVariant('hero-cta');
  await vi.waitFor(() => expect(recorded).toEqual([HERO]));
  flame.reset();
  // On this load ember never answers: only the stored copy can serve.
  stubEmber(new Promise(() => {}));
}

/** Every render's state, per experiment, in order. */
let seen: Record<string, string[]> = {};

function Probe({ id }: { id: string }) {
  const { variant, isLoading } = useExperiment(id);
  const state = isLoading ? 'loading' : (variant?.name ?? 'control');
  (seen[id] ??= []).push(state);
  return <span data-testid={id}>{state}</span>;
}

let flame: Flame;

function App({ on = flame, loadingLimitMs = 60_000 }: { on?: Flame; loadingLimitMs?: number }) {
  return (
    <CupedProvider dsn={DSN} flame={on} enableBatching={false} loadingLimitMs={loadingLimitMs}>
      <Probe id="hero-cta" />
      <Probe id="pricing" />
    </CupedProvider>
  );
}

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('flame_device_id', 'user-1');
  recorded = [];
  seen = {};
  await firstVisit();
  flame = new Flame();
});

afterEach(() => {
  flame.reset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a returning visitor's saved arm", () => {
  it('is on the first render, not loading, before flame is ready', () => {
    render(<App />);
    expect(seen['hero-cta'][0]).toBe('Treatment');
    expect(flame.isInitialized()).toBe(false);
  });

  it('leaves an experiment with no saved arm loading, until flame is ready', async () => {
    render(<App />);
    expect(seen['pricing'][0]).toBe('loading');
    await waitFor(() => expect(seen['pricing'].at(-1)).not.toBe('loading'));
    expect(flame.isInitialized()).toBe(true);
  });

  it('leaves an experiment with no saved arm to the loading limit', () => {
    render(<App loadingLimitMs={0} />);
    expect(seen['hero-cta'][0]).toBe('Treatment');
    expect(seen['pricing'][0]).toBe('control');
  });

  it('records nothing itself: once ready, only the read records, once per arm', async () => {
    render(<App />);
    // hero-cta was recorded on the first visit; pricing is read for the first time.
    await waitFor(() => expect(recorded).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(recorded.slice(1)).toEqual([rules.experiments[1].id]);
    expect(seen['hero-cta'].at(-1)).toBe('Treatment');
  });

  it('under Strict Mode, is the same on both renders, and init runs once', async () => {
    const init = vi.spyOn(flame, 'init');
    render(
      <StrictMode>
        <App />
      </StrictMode>
    );
    expect(seen['hero-cta'].slice(0, 2)).toEqual(['Treatment', 'Treatment']);
    await waitFor(() => expect(flame.isInitialized()).toBe(true));
    expect(init).toHaveBeenCalledTimes(1);
  });
});

describe('a hydration, after a server render with no prehydrated', () => {
  /** Server HTML as a server renders it: no browser storage, flame not ready. */
  function serverHtml(): string {
    const stored = Object.entries(localStorage);
    localStorage.clear();
    const html = renderToString(<App on={new Flame()} />);
    stored.forEach(([key, value]) => localStorage.setItem(key, value));
    return html;
  }

  async function hydrate(html: string) {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const mismatch = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    seen = {};
    await act(async () => {
      hydrateRoot(container, <App />, { onRecoverableError: mismatch });
    });
    await act(() => flame.ready);
    container.remove();
    return { container, mismatch, consoleError };
  }

  it('matches the server with a saved arm, then shows it', async () => {
    const html = serverHtml();
    expect(html).toContain('loading');
    const { container, mismatch, consoleError } = await hydrate(html);
    expect(seen['hero-cta'][0]).toBe('loading');
    expect(container.querySelector('[data-testid="hero-cta"]')?.textContent).toBe('Treatment');
    expect(mismatch).not.toHaveBeenCalled();
    expect(consoleError.mock.calls).toEqual([]);
  });

  it('matches the server with flame already ready in the browser', async () => {
    await flame.init({ dsn: DSN, enableBatching: false });
    const html = serverHtml();
    const { container, mismatch, consoleError } = await hydrate(html);
    expect(seen['hero-cta'][0]).toBe('loading');
    expect(container.querySelector('[data-testid="hero-cta"]')?.textContent).toBe('Treatment');
    expect(mismatch).not.toHaveBeenCalled();
    expect(consoleError.mock.calls).toEqual([]);
  });
});
