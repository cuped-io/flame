import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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

  it('outside a provider returns isLoading=true forever', () => {
    const results: ReturnType<typeof useExperiment>[] = [];
    render(<ExperimentProbe id="exp-1" onResult={(r) => results.push(r)} />);
    expect(results[0]).toEqual({ variant: null, isLoading: true });
  });
});
