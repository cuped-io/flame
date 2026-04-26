import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CupedProvider } from './provider';
import { Experiment } from './Experiment';
import { createStubFlame, makeVariant } from './test-utils';

describe('<Experiment>', () => {
  it('renders the entry matching the assigned variant name', async () => {
    const { flame } = createStubFlame({
      assignments: {
        'hero-cta': makeVariant({ name: 'green', is_control: false }),
      },
    });

    const { findByText } = render(
      <CupedProvider dsn="x" flame={flame}>
        <Experiment
          id="hero-cta"
          variants={{
            control: <span>blue button</span>,
            green: <span>green button</span>,
          }}
        />
      </CupedProvider>
    );

    expect(await findByText('green button')).toBeTruthy();
  });

  it('renders fallback while loading', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const { getByText } = render(
      <CupedProvider dsn="x" flame={flame}>
        <Experiment
          id="hero-cta"
          variants={{ control: <span>default</span> }}
          fallback={<span>loading...</span>}
        />
      </CupedProvider>
    );
    expect(getByText('loading...')).toBeTruthy();
  });

  it('falls back to variants.control while loading if no fallback prop', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const { getByText } = render(
      <CupedProvider dsn="x" flame={flame}>
        <Experiment id="hero-cta" variants={{ control: <span>control text</span>, green: <span>green text</span> }} />
      </CupedProvider>
    );
    expect(getByText('control text')).toBeTruthy();
  });

  it('falls through to control when assigned variant name has no entry', async () => {
    const { flame } = createStubFlame({
      assignments: {
        'hero-cta': makeVariant({ name: 'unknown-variant' }),
      },
    });
    const { findByText } = render(
      <CupedProvider dsn="x" flame={flame}>
        <Experiment
          id="hero-cta"
          variants={{
            control: <span>control fallback</span>,
            green: <span>not picked</span>,
          }}
        />
      </CupedProvider>
    );
    expect(await findByText('control fallback')).toBeTruthy();
  });

  it('renders null when neither fallback nor control is provided and loading', () => {
    const { flame } = createStubFlame({ autoInit: false });
    const { container } = render(
      <CupedProvider dsn="x" flame={flame}>
        <Experiment id="hero-cta" variants={{ green: <span>green</span> }} />
      </CupedProvider>
    );
    expect(container.textContent).toBe('');
  });
});
