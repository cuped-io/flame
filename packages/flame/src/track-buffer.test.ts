import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Flame } from './index';
import { TrackingManager } from './tracking';
import type { PrehydratedState } from './types';

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';
const prehydrated: PrehydratedState = {
  user_id: 'u1',
  user_id_created_at: '2024-01-01T00:00:00Z',
  experiments: [],
  assignments: {},
};

describe('flame.track() before init — pre-init buffering (#20)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))
    );
  });

  it('buffers events fired before init and delivers them once init completes', async () => {
    const trackSpy = vi.spyOn(TrackingManager.prototype, 'track');
    const flame = new Flame();

    // Fired before init() runs. useTrack's docstring promises this is buffered,
    // not dropped — but core track() currently returns early when there is no
    // tracking manager yet, silently losing the event.
    flame.track('early_event', { a: 1 });
    expect(
      trackSpy,
      'a pre-init event must not be sent yet — it should be buffered, not dropped'
    ).not.toHaveBeenCalled();

    await flame.init({ dsn: DSN, prehydrated });

    // Once init sets up the tracking manager, the buffered event is delivered.
    expect(trackSpy).toHaveBeenCalledWith('early_event', { a: 1 });
  });
});
