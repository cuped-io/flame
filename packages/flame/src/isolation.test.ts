import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Flame } from './index';
import { TrackingManager } from './tracking';
import type { AssignmentResponse, Experiment, VariantChange } from './types';

// flame#35: one experiment's failure must not stop the others. A failing
// /assign used to reject the whole Promise.all batch into init's catch, and
// an invalid selector threw out of the apply loop, so no variant applied, no
// pageview was tracked and the anti-flicker hide was never revealed.

const DSN = 'https://0123456789abcdef0123456789abcdef@example.com';

function experiment(id: string, changes: VariantChange[]): Experiment {
  return {
    id,
    project_id: 'proj-1',
    name: id,
    description: null,
    status: 'running',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    goals: [],
    variants: [
      {
        id: `${id}-variant`,
        experiment_id: id,
        name: 'treatment',
        description: null,
        is_control: false,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        changes,
      },
    ],
  };
}

function assigned(id: string): AssignmentResponse {
  return {
    assignment_id: `${id}-assignment`,
    experiment_id: id,
    variant_id: `${id}-variant`,
    variant_name: 'treatment',
    is_control: false,
    assigned_at: '2024-01-01T00:00:00Z',
  };
}

function stubApi(experiments: Experiment[], failAssignFor: string | null = null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/experiments/active')) {
        return new Response(JSON.stringify({ experiments }), { status: 200 });
      }
      const m = url.match(/\/experiments\/([^/]+)\/assign$/);
      if (m) {
        if (m[1] === failAssignFor) return new Response('{"error":"internal"}', { status: 500 });
        return new Response(JSON.stringify(assigned(m[1])), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    })
  );
}

const text = (id: string) => document.getElementById(id)?.textContent;

describe('flame.init() isolates one experiment from another (flame#35)', () => {
  let reveal: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.body.innerHTML = '<h1 id="a">A original</h1><h1 id="b">B original</h1>';
    reveal = vi.fn();
    (window as unknown as { __cupedAntiflicker: unknown }).__cupedAntiflicker = {
      revealed: false,
      reveal,
    };
  });

  afterEach(() => {
    delete (window as unknown as { __cupedAntiflicker?: unknown }).__cupedAntiflicker;
  });

  it('a 500 from one /assign still applies the other experiment, tracks the pageview and reveals', async () => {
    const pageview = vi.spyOn(TrackingManager.prototype, 'trackPageview');
    stubApi(
      [
        experiment('exp-a', [{ type: 'text', selector: '#a', value: 'A variant' }]),
        experiment('exp-b', [{ type: 'text', selector: '#b', value: 'B variant' }]),
      ],
      'exp-a'
    );

    await new Flame().init({ dsn: DSN });

    expect(text('a')).toBe('A original');
    expect(text('b')).toBe('B variant');
    expect(pageview).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('an invalid selector in one experiment still applies the other and reveals', async () => {
    stubApi([
      experiment('exp-a', [{ type: 'text', selector: '#a[', value: 'A variant' }]),
      experiment('exp-b', [{ type: 'text', selector: '#b', value: 'B variant' }]),
    ]);

    await new Flame().init({ dsn: DSN });

    expect(text('b')).toBe('B variant');
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('a bad change does not stop the later changes of the same variant', async () => {
    stubApi([
      experiment('exp-a', [
        { type: 'text', selector: '#a[', value: 'never' },
        { type: 'text', selector: '#a', value: 'A variant' },
      ]),
    ]);

    await new Flame().init({ dsn: DSN });

    expect(text('a')).toBe('A variant');
  });
});
