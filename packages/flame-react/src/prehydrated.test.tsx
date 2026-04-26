import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { render, act } from '@testing-library/react';
import type { PrehydratedState } from '@cuped-io/flame';
import { CupedProvider } from './provider';
import { useExperiment } from './useExperiment';
import { Experiment } from './Experiment';
import { createStubFlame, makeVariant } from './test-utils';

const variant = makeVariant({
  id: 'variant-A',
  name: 'green',
  is_control: false,
});

const prehydrated: PrehydratedState = {
  user_id: 'edge-user-123',
  experiments: [
    {
      id: 'exp-1',
      project_id: 'proj-1',
      name: 'Hero CTA',
      description: null,
      status: 'running',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      goals: [],
      variants: [variant],
    },
  ],
  assignments: {
    'exp-1': {
      experimentId: 'exp-1',
      variantId: 'variant-A',
      userId: 'edge-user-123',
      assignedAt: '2024-01-01T00:00:00Z',
    },
  },
};

function Probe({ id }: { id: string }) {
  const { variant, isLoading } = useExperiment(id);
  if (isLoading) return <span data-testid="state">loading</span>;
  return <span data-testid="state">{variant ? variant.name : 'null'}</span>;
}

describe('SSR with prehydrated', () => {
  it('renderToString emits the assigned variant on the server', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const html = renderToString(
      <CupedProvider dsn="x" flame={flame} prehydrated={prehydrated}>
        <Probe id="exp-1" />
      </CupedProvider>
    );
    // Server render must show the resolved variant, NOT "loading"
    // and NOT the control fallback.
    expect(html).toContain('green');
    expect(html).not.toContain('loading');
  });

  it('first client render returns the variant synchronously (no flash)', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const { getByTestId } = render(
      <CupedProvider dsn="x" flame={flame} prehydrated={prehydrated}>
        <Probe id="exp-1" />
      </CupedProvider>
    );
    // Without prehydrated this would be "loading"; with prehydrated,
    // the very first render has the variant.
    expect(getByTestId('state').textContent).toBe('green');
  });

  it('Experiment component renders the matching variant on server', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const html = renderToString(
      <CupedProvider dsn="x" flame={flame} prehydrated={prehydrated}>
        <Experiment
          id="exp-1"
          variants={{
            control: <span>blue</span>,
            green: <span>green-cta</span>,
          }}
        />
      </CupedProvider>
    );
    expect(html).toContain('green-cta');
    expect(html).not.toContain('blue');
  });

  it('experiments not in prehydrated resolve to null (not loading)', () => {
    // Prehydrated is the source of truth — if the cookie didn't
    // include this experiment, the user wasn't assigned. Returning
    // "loading" would be lying.
    const { flame } = createStubFlame({ autoInit: false });
    const { getByTestId } = render(
      <CupedProvider dsn="x" flame={flame} prehydrated={prehydrated}>
        <Probe id="other-exp" />
      </CupedProvider>
    );
    expect(getByTestId('state').textContent).toBe('null');
  });

  it('without prehydrated, server render shows loading (v0.1 fallback path)', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const html = renderToString(
      <CupedProvider dsn="x" flame={flame}>
        <Probe id="exp-1" />
      </CupedProvider>
    );
    expect(html).toContain('loading');
  });

  it('forwards prehydrated to flame.init', async () => {
    const { flame } = createStubFlame();
    render(
      <CupedProvider dsn="x" flame={flame} prehydrated={prehydrated}>
        <div>app</div>
      </CupedProvider>
    );
    // Flush microtasks inside act() so the post-init setState
    // fires before we assert.
    await act(async () => {
      await Promise.resolve();
    });
    expect(flame.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'x', prehydrated })
    );
  });
});
