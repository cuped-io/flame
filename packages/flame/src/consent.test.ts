import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { Experiment } from './types';
import { evaluateBody } from './test-evaluation';

// flame#18, design revised 2026-10-11 (recorded on the issue).

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

const experiment: Experiment = {
  id: 'exp-1',
  project_id: 'proj-1',
  name: 'Hero',
  description: null,
  status: 'running',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  goals: [{ name: 'cta_click', type: 'click', selector: '#cta' }],
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

type Call = { url: string; body: unknown };

/**
 * Every request flame makes, by fetch or sendBeacon, lands in `calls`.
 * `evaluateGate`: `/evaluate` answers only once it resolves.
 */
function stubApi(evaluateGate?: Promise<void>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/experiments/active')) {
        return new Response(JSON.stringify({ experiments: [experiment] }), { status: 200 });
      }
      if (url.endsWith('/evaluate')) {
        await evaluateGate;
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
  // The queue flushes by sendBeacon (absent in jsdom, where a flush would
  // instead fall back to offline storage). Capture what it carries.
  vi.stubGlobal('navigator', {
    ...navigator,
    sendBeacon: vi.fn((url: string | URL, data?: BodyInit | null) => {
      calls.push({ url: String(url), body: data });
      return true;
    }),
  });
  return calls;
}

/** Everything flame sent, fetch bodies and beacon blobs, as one string. */
async function sentText(calls: Call[]): Promise<string> {
  // The beacon carries a jsdom Blob, which is not Node's Blob and has no
  // .text(); FileReader reads it.
  const read = (b: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(b);
    });
  const isBlob = (v: unknown): v is Blob =>
    !!v && typeof v === 'object' && (v as object).constructor?.name === 'Blob';
  const parts = await Promise.all(
    calls.map((c) => (isBlob(c.body) ? read(c.body) : Promise.resolve(JSON.stringify(c.body))))
  );
  return parts.join('\n');
}

function hideTab() {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  window.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pagehide'));
}

const headline = () => document.getElementById('headline')?.textContent;
const flameKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('flame_'));
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('consent (flame#18)', () => {
  let flame: Flame;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '<h1 id="headline">Original</h1><button id="cta">Go</button>';
  });

  afterEach(() => {
    flame?.reset();
    delete (window as unknown as { __cupedAntiflicker?: unknown }).__cupedAntiflicker;
  });

  it('with consent required and no choice yet: nothing sent, nothing stored, original page, page revealed', async () => {
    const calls = stubApi();
    const reveal = vi.fn();
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = {
      revealed: false,
      reveal,
    };
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });
    flame.track('custom_event');
    document.getElementById('cta')!.click();
    await settle();

    expect(calls).toHaveLength(0);
    expect(flameKeys()).toEqual([]);
    expect(headline()).toBe('Original');
    expect(reveal).toHaveBeenCalled();
    expect(flame.consentState()).toBe('pending');
  });

  it('consent(true) applies the variant on the current page, saves the choice, and tracks; nothing from before counts', async () => {
    const calls = stubApi();
    // Like the real snippet: reveal() marks the page revealed. Pre-consent
    // reveals the original, and a revealed page normally blocks a late apply.
    const af = { revealed: false, reveal: () => (af.revealed = true) };
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = af;
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true, enableBatching: false });
    flame.track('before_consent');

    expect(flame.consent(true)).toBe('granted');
    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
    expect(flame.consentState()).toBe('granted');
    expect(localStorage.getItem('flame_consent')).toBe('granted');
    flame.track('after_consent');
    await vi.waitFor(async () => expect(await sentText(calls)).toContain('after_consent'));
    expect(await sentText(calls)).not.toContain('before_consent');
  });

  // Positive control for the withdrawal test below: the same setup without
  // withdrawal must show the queued event reaching ember, or the "nothing
  // sent" assertion there could pass on a spy that catches nothing.
  it('positive control: with consent, a queued event IS sent when the tab is hidden', async () => {
    const calls = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true, flushIntervalMs: 60_000 });
    flame.consent(true);
    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
    flame.track('queued_event');

    hideTab();
    await settle();

    expect(await sentText(calls)).toContain('queued_event');
  });

  it('consent(false) with an event queued: nothing more is sent and everything stored is deleted', async () => {
    const calls = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true, flushIntervalMs: 60_000 });
    flame.consent(true);
    await vi.waitFor(() => expect(headline()).toBe('Variant headline'));
    flame.track('queued_event');
    const sentBefore = calls.length;

    expect(flame.consent(false)).toBe('denied');
    hideTab();
    flame.track('after_withdrawal');
    document.getElementById('cta')!.click();
    await settle();

    expect(calls.length).toBe(sentBefore);
    expect(await sentText(calls)).not.toContain('queued_event');
    // Only the refusal itself remains, so it is honoured on later pages.
    expect(flameKeys()).toEqual(['flame_consent']);
    expect(localStorage.getItem('flame_consent')).toBe('denied');
    // The page is left as it is.
    expect(headline()).toBe('Variant headline');
  });

  // A start still waiting on the network when consent is withdrawn, or the
  // SDK reset, must not carry on when the answer arrives.
  function gate() {
    let open!: () => void;
    const opened = new Promise<void>((r) => (open = r));
    return { opened, open };
  }

  it('consent(false) while the evaluation is in flight: the start stops, nothing changes, nothing is stored', async () => {
    const evaluation = gate();
    const calls = stubApi(evaluation.opened);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });
    flame.consent(true);
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/evaluate'))).toBe(true));
    const sentBefore = calls.length;

    expect(flame.consent(false)).toBe('denied');
    evaluation.open();
    await settle();
    // A target re-created after withdrawal stays original: no watcher.
    document.body.innerHTML = '<h1 id="headline">Original</h1>';
    await settle();

    expect(calls.length).toBe(sentBefore);
    expect(headline()).toBe('Original');
    expect(flameKeys()).toEqual(['flame_consent']);
    expect(error).not.toHaveBeenCalled();
  });

  it('reset() while the evaluation is in flight: the variant is not applied or recorded', async () => {
    const evaluation = gate();
    const calls = stubApi(evaluation.opened);
    flame = new Flame();
    const started = flame.init({ dsn: DSN, enableBatching: false });
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/evaluate'))).toBe(true));
    const sentBefore = calls.length;

    flame.reset();
    evaluation.open();
    await started;
    await settle();
    document.body.innerHTML = '<h1 id="headline">Original</h1>';
    await settle();

    expect(calls.length).toBe(sentBefore);
    expect(headline()).toBe('Original');
  });

  it('a saved grant starts flame at init on the next page: variant from the start, no swap', async () => {
    stubApi();
    localStorage.setItem('flame_consent', 'granted');
    const af = { revealed: false, reveal: vi.fn(() => (af.revealed = true)) };
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = af;
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });

    expect(headline()).toBe('Variant headline');
    expect(flame.consentState()).toBe('granted');
    // One reveal, after the variant applied: the original was never shown.
    expect(af.reveal).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])(
    'a saved refusal keeps flame off on the next page (requireConsent: %s)',
    async (requireConsent) => {
      const calls = stubApi();
      localStorage.setItem('flame_consent', 'denied');
      flame = new Flame();
      await flame.init({ dsn: DSN, requireConsent });
      flame.track('ignored');
      await settle();

      expect(calls).toHaveLength(0);
      expect(headline()).toBe('Original');
      expect(flame.consentState()).toBe('denied');
    }
  );

  const SIGNALS = [
    ['Global Privacy Control', { globalPrivacyControl: true }],
    ['Do Not Track', { doNotTrack: '1' }],
  ] as const;

  it.each(SIGNALS)(
    'with %s on, flame stays off even when consent is not required',
    async (_name, signal) => {
      const calls = stubApi();
      vi.stubGlobal('navigator', { ...navigator, ...signal });
      flame = new Flame();
      await flame.init({ dsn: DSN });
      await settle();

      expect(calls).toHaveLength(0);
      expect(flameKeys()).toEqual([]);
      expect(headline()).toBe('Original');
      expect(flame.consentState()).toBe('blocked_by_signal');
    }
  );

  it.each(SIGNALS)(
    "with %s on, consent(true) returns blocked_by_signal, warns with the signal's name, and nothing runs",
    async (name, signal) => {
      const calls = stubApi();
      vi.stubGlobal('navigator', { ...navigator, ...signal });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      flame = new Flame();
      await flame.init({ dsn: DSN, requireConsent: true });

      expect(flame.consent(true)).toBe('blocked_by_signal');
      await settle();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
      expect(calls).toHaveLength(0);
      expect(flameKeys()).toEqual([]);
      expect(headline()).toBe('Original');
    }
  );

  it('accepting again after a withdrawal starts a new visitor', async () => {
    stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });
    flame.consent(true);
    await vi.waitFor(() => expect(localStorage.getItem('flame_device_id')).toBeTruthy());
    const first = localStorage.getItem('flame_device_id');

    flame.consent(false);
    expect(flame.consent(true)).toBe('granted');
    await vi.waitFor(() => expect(localStorage.getItem('flame_device_id')).toBeTruthy());

    expect(localStorage.getItem('flame_device_id')).not.toBe(first);
  });

  it("consentApply: 'next-page' saves the grant but changes nothing on this page", async () => {
    const calls = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true, consentApply: 'next-page' });

    expect(flame.consent(true)).toBe('granted');
    await settle();

    expect(calls).toHaveLength(0);
    expect(headline()).toBe('Original');
    expect(localStorage.getItem('flame_consent')).toBe('granted');
  });

  it('without requireConsent, no signal and no saved choice, flame runs as before', async () => {
    const calls = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN });

    expect(headline()).toBe('Variant headline');
    expect(flame.consentState()).toBe('not_required');
    expect(calls.length).toBeGreaterThan(0);
    // No consent choice was made, so none is recorded.
    expect(localStorage.getItem('flame_consent')).toBeNull();
  });

  // The script-tag install reads its settings from data- attributes.
  // flame starts itself when the module loads, so load a fresh copy.
  async function loadFromScriptTag(attrs: Record<string, string>) {
    const tag = document.createElement('script');
    tag.setAttribute('data-dsn', DSN);
    for (const [k, v] of Object.entries(attrs)) tag.setAttribute(k, v);
    document.head.appendChild(tag);
    vi.resetModules();
    const mod = await import('./index');
    flame = mod.flame as unknown as Flame;
    await settle();
    tag.remove();
    return mod.flame;
  }

  it('script tag: data-consent="required" waits for consent', async () => {
    const calls = stubApi();
    const loaded = await loadFromScriptTag({ 'data-consent': 'required' });

    expect(loaded.consentState()).toBe('pending');
    expect(calls).toHaveLength(0);
  });

  it('script tag: data-consent-apply="next-page" makes an accept wait for the next page', async () => {
    const calls = stubApi();
    const loaded = await loadFromScriptTag({
      'data-consent': 'required',
      'data-consent-apply': 'next-page',
    });

    expect(loaded.consent(true)).toBe('granted');
    await settle();
    expect(calls).toHaveLength(0);
    expect(headline()).toBe('Original');
  });
});
