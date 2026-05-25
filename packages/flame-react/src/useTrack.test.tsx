import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { CupedProvider } from './provider';
import { useTrack } from './useTrack';
import { createStubFlame } from './test-utils';

function TrackProbe({ onReady }: { onReady: (fn: ReturnType<typeof useTrack>) => void }) {
  const track = useTrack();
  onReady(track);
  return null;
}

/**
 * Flush microtasks within an act() scope so the provider's
 * post-render `flame.init()` resolution and its setState fire
 * before the test asserts. Without this, the setState would land
 * after the test ends and React logs an "update not wrapped in
 * act(...)" warning.
 */
async function flushInit() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useTrack', () => {
  it('calls flame.track with the given event and metadata', async () => {
    const { flame, trackMock } = createStubFlame();
    let track: ReturnType<typeof useTrack> = () => {};

    render(
      <CupedProvider dsn="x" flame={flame}>
        <TrackProbe onReady={(fn) => (track = fn)} />
      </CupedProvider>
    );
    await flushInit();

    track('signup_completed', { plan: 'pro' });
    expect(trackMock).toHaveBeenCalledWith('signup_completed', { plan: 'pro' });
  });

  it('returns a stable function across renders', async () => {
    const { flame } = createStubFlame();
    const refs: ReturnType<typeof useTrack>[] = [];

    const { rerender } = render(
      <CupedProvider dsn="x" flame={flame}>
        <TrackProbe onReady={(fn) => refs.push(fn)} />
      </CupedProvider>
    );
    await flushInit();
    rerender(
      <CupedProvider dsn="x" flame={flame}>
        <TrackProbe onReady={(fn) => refs.push(fn)} />
      </CupedProvider>
    );

    expect(refs[0]).toBe(refs[1]);
  });

  it('warns when called outside a provider and drops the event', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let track: ReturnType<typeof useTrack> = () => {};

    render(<TrackProbe onReady={(fn) => (track = fn)} />);
    track('event', {});

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
