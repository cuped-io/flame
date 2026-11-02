import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CupedProvider } from './provider';
import { CupedContext, type CupedContextValue } from './context';
import { useContext } from 'react';
import { createStubFlame } from './test-utils';
import { useExperiment } from './useExperiment';
import { Flame } from '@cuped-io/flame';

function ContextProbe({ onValue }: { onValue: (v: CupedContextValue) => void }) {
  const value = useContext(CupedContext);
  onValue(value);
  return null;
}

describe('CupedProvider', () => {
  it('calls flame.init exactly once on mount', async () => {
    const { flame } = createStubFlame();
    render(
      <CupedProvider dsn="https://pk_live_x@api.example.com" flame={flame}>
        <div>app</div>
      </CupedProvider>
    );
    await waitFor(() => {
      expect(flame.init).toHaveBeenCalledTimes(1);
    });
    expect(flame.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://pk_live_x@api.example.com' })
    );
  });

  it('is not ready initially, and ready after init', async () => {
    const { flame, resolveInit } = createStubFlame({ autoInit: false });
    const values: CupedContextValue[] = [];

    render(
      <CupedProvider dsn="https://pk_live_x@api.example.com" flame={flame}>
        <ContextProbe onValue={(v) => values.push({ ...v })} />
      </CupedProvider>
    );

    // Initial render: not initialized yet.
    expect(values[0]?.ready).toBe(false);

    resolveInit();
    await waitFor(() => {
      expect(values.at(-1)?.ready).toBe(true);
    });
  });

  it('renders children even before init resolves', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const { getByText } = render(
      <CupedProvider dsn="https://pk_live_x@api.example.com" flame={flame}>
        <div>visible immediately</div>
      </CupedProvider>
    );
    expect(getByText('visible immediately')).toBeTruthy();
  });

  it('skips init if flame is already initialized', async () => {
    const { flame } = createStubFlame();
    // Pre-init the stub.
    await flame.init({ dsn: 'x' });
    expect(flame.isInitialized()).toBe(true);
    vi.clearAllMocks();

    render(
      <CupedProvider dsn="https://pk_live_x@api.example.com" flame={flame}>
        <div>app</div>
      </CupedProvider>
    );

    expect(flame.init).not.toHaveBeenCalled();
  });

  it('logs an error if flame.init rejects but still marks ready', async () => {
    const { flame } = createStubFlame();
    (flame.init as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const values: CupedContextValue[] = [];
    render(
      <CupedProvider dsn="https://pk_live_x@api.example.com" flame={flame}>
        <ContextProbe onValue={(v) => values.push({ ...v })} />
      </CupedProvider>
    );

    await waitFor(() => {
      expect(values.at(-1)?.ready).toBe(true);
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('CupedProvider when ember never answers (flame#58)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('stops loading once the request limit passes, and shows control', async () => {
    // Like a real fetch: pending until its signal aborts.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          })
      )
    );
    const flame = new Flame();
    function Probe() {
      const { variant, isLoading } = useExperiment('exp-1');
      return (
        <span data-testid="state">{isLoading ? 'loading' : (variant?.name ?? 'control')}</span>
      );
    }

    const { getByTestId } = render(
      // A render limit far past the request limit: only the request limit can end loading.
      <CupedProvider
        dsn="https://0123456789abcdef0123456789abcdef@api.example.com"
        flame={flame}
        enableBatching={false}
        requestTimeoutMs={50}
        loadingLimitMs={60_000}
      >
        <Probe />
      </CupedProvider>
    );
    expect(getByTestId('state').textContent).toBe('loading');

    await waitFor(() => expect(getByTestId('state').textContent).toBe('control'), {
      timeout: 1000,
    });
    flame.reset();
  });
});
