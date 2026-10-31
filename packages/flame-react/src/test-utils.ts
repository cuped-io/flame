import { vi } from 'vitest';
import type { Flame, Variant } from '@cuped-io/flame';

/**
 * Build a stub flame instance that satisfies the surface used by
 * the React provider/hooks (init, isInitialized, getAssignedVariantInfo,
 * track). Does not mock the rest of the SDK.
 *
 * `getAssignedVariantInfo` stands in for the core's read, whose first read
 * of a real arm records it (flame#24). Like the core, it answers `null`
 * before init completes. `readMock` shows which experiments were read.
 */
export function createStubFlame(
  opts: {
    /**
     * Variants to "assign" — keyed by experiment id. The hook returns
     * these via `getAssignedVariantInfo`.
     */
    assignments?: Record<string, Variant>;
    /**
     * If true, init() resolves immediately. Otherwise returns a
     * promise the caller can resolve manually via the returned
     * `resolveInit` handle (for testing the loading state).
     */
    autoInit?: boolean;
    /** If true, the stub is initialized before anything renders. */
    ready?: boolean;
  } = {}
): {
  flame: Flame;
  resolveInit: () => void;
  trackMock: ReturnType<typeof vi.fn>;
  readMock: ReturnType<typeof vi.fn>;
} {
  const { assignments = {}, autoInit = true, ready = false } = opts;
  let initialized = ready;
  let resolveInit: () => void = () => {};

  const initPromise = autoInit
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        resolveInit = () => {
          initialized = true;
          resolve();
        };
      });

  const trackMock = vi.fn();
  const readMock = vi.fn((experimentId: string): Variant | null =>
    initialized ? (assignments[experimentId] ?? null) : null
  );

  const stub = {
    isInitialized: () => initialized,
    init: vi.fn(async () => {
      if (autoInit) {
        initialized = true;
        return;
      }
      await initPromise;
    }),
    getAssignedVariantInfo: readMock,
    track: trackMock,
  } as unknown as Flame;

  return {
    flame: stub,
    resolveInit: () => {
      initialized = true;
      resolveInit();
    },
    trackMock,
    readMock,
  };
}

/** Build a minimal Variant object for tests. */
export function makeVariant(overrides: Partial<Variant> = {}): Variant {
  return {
    id: 'variant-1',
    experiment_id: 'exp-1',
    name: 'control',
    description: null,
    is_control: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}
