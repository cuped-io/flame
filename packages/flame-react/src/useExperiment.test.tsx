import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { CupedProvider } from './provider';
import { useExperiment } from './useExperiment';
import { createStubFlame, makeVariant } from './test-utils';

function ExperimentProbe({
  id,
  onResult,
}: {
  id: string;
  onResult: (r: ReturnType<typeof useExperiment>) => void;
}) {
  const result = useExperiment(id);
  onResult(result);
  return null;
}

describe('useExperiment', () => {
  it('returns isLoading=true before init', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const results: ReturnType<typeof useExperiment>[] = [];

    render(
      <CupedProvider dsn="x" flame={flame}>
        <ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />
      </CupedProvider>
    );

    expect(results[0]).toEqual({ variant: null, isLoading: true });
  });

  it('returns the assigned variant once init completes', async () => {
    const variant = makeVariant({ name: 'green', is_control: false });
    const { flame } = createStubFlame({
      assignments: { 'exp-1': variant },
    });

    const results: ReturnType<typeof useExperiment>[] = [];
    render(
      <CupedProvider dsn="x" flame={flame}>
        <ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />
      </CupedProvider>
    );

    await waitFor(() => {
      expect(results.at(-1)).toEqual({ variant, isLoading: false });
    });
  });

  it('returns variant=null with isLoading=false when no assignment exists', async () => {
    const { flame } = createStubFlame({ assignments: {} });

    const results: ReturnType<typeof useExperiment>[] = [];
    render(
      <CupedProvider dsn="x" flame={flame}>
        <ExperimentProbe id="missing" onResult={(r) => results.push(r)} />
      </CupedProvider>
    );

    await waitFor(() => {
      expect(results.at(-1)).toEqual({ variant: null, isLoading: false });
    });
  });

  it('has the arm on the first render when flame already knows it', () => {
    const variant = makeVariant({ name: 'green', is_control: false });
    const { flame } = createStubFlame({ ready: true, assignments: { 'exp-1': variant } });
    const results: ReturnType<typeof useExperiment>[] = [];

    render(
      <CupedProvider dsn="x" flame={flame}>
        <ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />
      </CupedProvider>
    );

    expect(results[0]).toEqual({ variant, isLoading: false });
  });

  it('reads, and so records, only the experiments whose hook renders', async () => {
    const { flame, readMock } = createStubFlame({
      assignments: {
        'exp-1': makeVariant({ experiment_id: 'exp-1', name: 'green', is_control: false }),
        'exp-2': makeVariant({ experiment_id: 'exp-2', name: 'red', is_control: false }),
      },
    });

    render(
      <CupedProvider dsn="x" flame={flame}>
        <ExperimentProbe id="exp-1" onResult={() => {}} />
      </CupedProvider>
    );

    await waitFor(() => expect(readMock).toHaveBeenCalledWith('exp-1'));
    expect(readMock).not.toHaveBeenCalledWith('exp-2');
  });

  describe('loading limit', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('a new visitor is loading until 200 ms pass, then gets control', () => {
      const { flame } = createStubFlame({ autoInit: false });
      const results: ReturnType<typeof useExperiment>[] = [];
      render(
        <CupedProvider dsn="x" flame={flame}>
          <ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />
        </CupedProvider>
      );

      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(results.at(-1)).toEqual({ variant: null, isLoading: true });

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(results.at(-1)).toEqual({ variant: null, isLoading: false });
    });

    it('gives the arm when the rules file arrives before the limit', async () => {
      const variant = makeVariant({ name: 'green', is_control: false });
      const { flame, resolveInit } = createStubFlame({
        autoInit: false,
        assignments: { 'exp-1': variant },
      });
      const results: ReturnType<typeof useExperiment>[] = [];
      render(
        <CupedProvider dsn="x" flame={flame}>
          <ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />
        </CupedProvider>
      );

      act(() => {
        vi.advanceTimersByTime(150);
      });
      await act(async () => {
        resolveInit();
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(results.at(-1)).toEqual({ variant, isLoading: false });
    });

    it('with a limit of 0, still gives an arm flame already knows', () => {
      const variant = makeVariant({ name: 'green', is_control: false });
      const { flame } = createStubFlame({ ready: true, assignments: { 'exp-1': variant } });
      const results: ReturnType<typeof useExperiment>[] = [];
      render(
        <CupedProvider dsn="x" flame={flame} loadingLimitMs={0}>
          <ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />
        </CupedProvider>
      );
      expect(results[0]).toEqual({ variant, isLoading: false });
    });

    it('keeps control after the limit when the arm arrives later, and records nothing', async () => {
      const variant = makeVariant({ name: 'green', is_control: false });
      const { flame, resolveInit, readMock } = createStubFlame({
        autoInit: false,
        assignments: { 'exp-1': variant },
      });
      const results: ReturnType<typeof useExperiment>[] = [];
      render(
        <CupedProvider dsn="x" flame={flame}>
          <ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />
        </CupedProvider>
      );

      act(() => {
        vi.advanceTimersByTime(200);
      });
      await act(async () => {
        resolveInit();
      });

      expect(flame.isInitialized()).toBe(true);
      expect(results.at(-1)).toEqual({ variant: null, isLoading: false });
      expect(readMock).not.toHaveBeenCalled();
    });

    it('never reports loading when the limit is 0', async () => {
      const variant = makeVariant({ name: 'green', is_control: false });
      const { flame, resolveInit, readMock } = createStubFlame({
        autoInit: false,
        assignments: { 'exp-1': variant },
      });
      const results: ReturnType<typeof useExperiment>[] = [];
      render(
        <CupedProvider dsn="x" flame={flame} loadingLimitMs={0}>
          <ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />
        </CupedProvider>
      );
      await act(async () => {
        resolveInit();
      });

      expect(results.every((r) => !r.isLoading)).toBe(true);
      expect(results.at(-1)).toEqual({ variant: null, isLoading: false });
      expect(readMock).not.toHaveBeenCalled();
    });

    it('gives an experiment that first renders after flame is ready its arm', async () => {
      const green = makeVariant({ experiment_id: 'exp-2', name: 'green', is_control: false });
      const { flame, resolveInit } = createStubFlame({
        autoInit: false,
        assignments: { 'exp-1': makeVariant(), 'exp-2': green },
      });
      const late: ReturnType<typeof useExperiment>[] = [];
      const { rerender } = render(
        <CupedProvider dsn="x" flame={flame}>
          <ExperimentProbe id="exp-1" onResult={() => {}} />
        </CupedProvider>
      );
      act(() => {
        vi.advanceTimersByTime(200);
      });
      await act(async () => {
        resolveInit();
      });

      rerender(
        <CupedProvider dsn="x" flame={flame}>
          <ExperimentProbe id="exp-1" onResult={() => {}} />
          <ExperimentProbe id="exp-2" onResult={(r) => late.push(r)} />
        </CupedProvider>
      );

      expect(late[0]).toEqual({ variant: green, isLoading: false });
    });
  });

  it('outside a provider returns isLoading=true forever', () => {
    const results: ReturnType<typeof useExperiment>[] = [];
    render(<ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />);
    expect(results[0]).toEqual({ variant: null, isLoading: true });
  });
});
