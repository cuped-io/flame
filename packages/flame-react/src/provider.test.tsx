import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { CupedProvider } from './provider';
import { CupedContext, type CupedContextValue } from './context';
import { useContext } from 'react';
import { createStubFlame } from './test-utils';

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

  it('exposes isLoading=true initially, isLoading=false after init', async () => {
    const { flame, resolveInit } = createStubFlame({ autoInit: false });
    const values: CupedContextValue[] = [];

    render(
      <CupedProvider dsn="https://pk_live_x@api.example.com" flame={flame}>
        <ContextProbe onValue={(v) => values.push({ ...v })} />
      </CupedProvider>
    );

    // Initial render: not initialized yet.
    expect(values[0]?.initialized).toBe(false);

    resolveInit();
    await waitFor(() => {
      expect(values.at(-1)?.initialized).toBe(true);
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

  it('logs an error if flame.init rejects but still marks initialized', async () => {
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
      expect(values.at(-1)?.initialized).toBe(true);
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
