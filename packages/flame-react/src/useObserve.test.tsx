import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { CupedProvider } from './provider';
import { useObserve } from './useObserve';
import { createStubFlame } from './test-utils';

function ObserveProbe({ onReady }: { onReady: (fn: ReturnType<typeof useObserve>) => void }) {
  const observe = useObserve();
  onReady(observe);
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

describe('useObserve', () => {
  it('calls flame.observe with the given event and metadata', async () => {
    const { flame, observeMock } = createStubFlame();
    let observe: ReturnType<typeof useObserve> = () => {};

    render(
      <CupedProvider dsn="x" flame={flame}>
        <ObserveProbe onReady={(fn) => (observe = fn)} />
      </CupedProvider>
    );
    await flushInit();

    observe('signup_completed', { plan: 'pro' });
    expect(observeMock).toHaveBeenCalledWith('signup_completed', { plan: 'pro' });
  });

  it('returns a stable function across renders', async () => {
    const { flame } = createStubFlame();
    const refs: ReturnType<typeof useObserve>[] = [];

    const { rerender } = render(
      <CupedProvider dsn="x" flame={flame}>
        <ObserveProbe onReady={(fn) => refs.push(fn)} />
      </CupedProvider>
    );
    await flushInit();
    rerender(
      <CupedProvider dsn="x" flame={flame}>
        <ObserveProbe onReady={(fn) => refs.push(fn)} />
      </CupedProvider>
    );

    expect(refs[0]).toBe(refs[1]);
  });

  it('warns when called outside a provider and drops the observation', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let observe: ReturnType<typeof useObserve> = () => {};

    render(<ObserveProbe onReady={(fn) => (observe = fn)} />);
    observe('event', {});

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
