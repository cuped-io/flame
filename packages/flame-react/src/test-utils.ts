import { vi } from 'vitest';
import type { Flame, Variant } from '@cuped-io/flame';

/**
 * Build a stub flame instance that satisfies the surface used by
 * the React provider/hooks (init, isInitialized, getAssignedVariantInfo,
 * observe). Does not mock the rest of the SDK.
 */
export function createStubFlame(opts: {
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
} = {}): { flame: Flame; resolveInit: () => void; observeMock: ReturnType<typeof vi.fn> } {
  const { assignments = {}, autoInit = true } = opts;
  let initialized = false;
  let resolveInit: () => void = () => {};

  const initPromise = autoInit
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        resolveInit = () => {
          initialized = true;
          resolve();
        };
      });

  const observeMock = vi.fn();

  const stub = {
    isInitialized: () => initialized,
    init: vi.fn(async () => {
      if (autoInit) {
        initialized = true;
        return;
      }
      await initPromise;
    }),
    getAssignedVariantInfo: (experimentId: string): Variant | null => {
      return assignments[experimentId] ?? null;
    },
    observe: observeMock,
  } as unknown as Flame;

  return {
    flame: stub,
    resolveInit: () => {
      initialized = true;
      resolveInit();
    },
    observeMock,
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
