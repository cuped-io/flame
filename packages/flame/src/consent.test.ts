import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import type { RulesFile } from './rules';

// flame#18, design revised 2026-10-11 (recorded on the issue).

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

// One arm with all the weight, so every visitor's pick is variant-A.
const rules: RulesFile = {
  version: 1,
  experiments: [
    {
      id: 'exp-1',
      slug: 'hero',
      url_pattern: null,
      variants: [{ id: 'variant-A', name: 'treatment', is_control: false, weight: 1 }],
    },
  ],
  holdout: null,
  promoted: [
    {
      id: 'exp-old',
      slug: 'old',
      url_pattern: null,
      winner_promoted_at: '2026-01-01T00:00:00Z',
      winner: { id: 'winner', name: 'Winner', is_control: false, weight: 1 },
    },
  ],
};

type Call = { url: string; body: unknown };

/**
 * Every request flame makes, by fetch or sendBeacon, lands in `calls`.
 * `rulesGate`: `/rules` answers only once it resolves.
 */
function stubApi(rulesGate?: Promise<void>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/rules')) {
        await rulesGate;
        return new Response(JSON.stringify(rules), { status: 200 });
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

const flameKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('flame_'));
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('consent (flame#18)', () => {
  let flame: Flame;
  // What page code reading the experiment gets: the arm, or null for control.
  const arm = () => flame.getVariant('hero');

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    flame?.reset();
  });

  it('with consent required and no choice yet: nothing sent, nothing stored, control', async () => {
    const calls = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });
    flame.track('custom_event');
    await settle();

    expect(calls).toHaveLength(0);
    expect(flameKeys()).toEqual([]);
    expect(arm()).toBeNull();
    expect(flame.consentState()).toBe('pending');
  });

  it('consent(true) gives the arm on the current page, saves the choice, and tracks; nothing from before counts', async () => {
    const calls = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true, enableBatching: false });
    flame.track('before_consent');

    expect(flame.consent(true)).toBe('granted');
    await vi.waitFor(() => expect(arm()).toBe('variant-A'));
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
    await vi.waitFor(() => expect(arm()).toBe('variant-A'));
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
    await vi.waitFor(() => expect(arm()).toBe('variant-A'));
    flame.track('queued_event');
    const sentBefore = calls.length;

    expect(flame.consent(false)).toBe('denied');
    hideTab();
    flame.track('after_withdrawal');
    await settle();

    expect(calls.length).toBe(sentBefore);
    expect(await sentText(calls)).not.toContain('queued_event');
    // Only the refusal itself remains, so it is honoured on later pages.
    expect(flameKeys()).toEqual(['flame_consent']);
    expect(localStorage.getItem('flame_consent')).toBe('denied');
    // Reads answer control from now on.
    expect(arm()).toBeNull();
  });

  // A start still waiting on the network when consent is withdrawn, or the
  // SDK reset, must not carry on when the answer arrives.
  function gate() {
    let open!: () => void;
    const opened = new Promise<void>((r) => (open = r));
    return { opened, open };
  }

  it('consent(false) while the rules file is in flight: the start stops, nothing changes, nothing is stored', async () => {
    const rulesFile = gate();
    const calls = stubApi(rulesFile.opened);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });
    flame.consent(true);
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/rules'))).toBe(true));
    const sentBefore = calls.length;

    expect(flame.consent(false)).toBe('denied');
    rulesFile.open();
    await settle();

    expect(calls.length).toBe(sentBefore);
    expect(arm()).toBeNull();
    expect(flameKeys()).toEqual(['flame_consent']);
    expect(error).not.toHaveBeenCalled();
  });

  it('reset() while the rules file is in flight: no arm is read or recorded', async () => {
    const rulesFile = gate();
    const calls = stubApi(rulesFile.opened);
    flame = new Flame();
    const started = flame.init({ dsn: DSN, enableBatching: false });
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/rules'))).toBe(true));
    const sentBefore = calls.length;

    flame.reset();
    rulesFile.open();
    await started;
    await settle();

    expect(calls.length).toBe(sentBefore);
    expect(arm()).toBeNull();
  });

  it('a saved grant starts flame at init on the next page: the arm from the start', async () => {
    stubApi();
    localStorage.setItem('flame_consent', 'granted');
    flame = new Flame();
    await flame.init({ dsn: DSN, requireConsent: true });

    expect(arm()).toBe('variant-A');
    expect(flame.consentState()).toBe('granted');
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
      expect(arm()).toBeNull();
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
      expect(arm()).toBeNull();
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
      expect(arm()).toBeNull();
    }
  );

  it('after a withdrawal, identify() brings no arm back', async () => {
    stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN });
    expect(flame.getVariant('old')).toBe('winner');

    flame.consent(false);
    await flame.identify('user-42');
    flame.clearIdentity();
    await settle();

    expect(flame.getVariant('old')).toBeNull();
    expect(arm()).toBeNull();
  });

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
    expect(arm()).toBeNull();
    expect(localStorage.getItem('flame_consent')).toBe('granted');
  });

  it('without requireConsent, no signal and no saved choice, flame runs as before', async () => {
    const calls = stubApi();
    flame = new Flame();
    await flame.init({ dsn: DSN });

    expect(arm()).toBe('variant-A');
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
    expect(arm()).toBeNull();
  });
});
