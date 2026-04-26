import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  flame as defaultFlame,
  type Flame,
  type FlameConfig,
  type PrehydratedState,
  type Variant,
} from '@cuped-io/flame';
import { CupedContext, type CupedContextValue } from './context';

export interface CupedProviderProps extends FlameConfig {
  children: ReactNode;

  /**
   * Pre-resolved assignments + experiments, produced at the edge by
   * `@cuped-io/flame-edge`. When supplied, the provider:
   *
   * 1. Renders the correct variant on the very first server render
   *    (no flash, no hydration mismatch).
   * 2. Forwards the state to `flame.init()` so the SDK skips its
   *    HTTP fetches.
   *
   * Without this prop, the provider falls back to the v0.1 behavior:
   * server renders the control branch, client refetches on mount.
   */
  prehydrated?: PrehydratedState;

  /**
   * Override the underlying flame instance.
   *
   * Defaults to the singleton exported from `@cuped-io/flame`. Override
   * mainly for tests; production apps should use the singleton so
   * everything (auto-tracking, identity, observation queue) shares
   * one instance.
   */
  flame?: Flame;
}

/**
 * Resolve `prehydrated` into a synchronous experimentId → Variant
 * map by joining the assignment list against the experiments list.
 */
function resolveAssignmentsFromPrehydrated(
  state: PrehydratedState | undefined
): Record<string, Variant> {
  if (!state) return {};
  const result: Record<string, Variant> = {};
  for (const [experimentId, assignment] of Object.entries(state.assignments)) {
    const experiment = state.experiments.find((e) => e.id === experimentId);
    if (!experiment || !experiment.variants) continue;
    const variant = experiment.variants.find((v) => v.id === assignment.variantId);
    if (variant) result[experimentId] = variant;
  }
  return result;
}

/**
 * Provides a configured flame SDK to the component tree.
 *
 * Mount once at the root of your app (under any auth providers,
 * above any consumer of `useExperiment` / `<Experiment>`):
 *
 * ```tsx
 * <CupedProvider dsn="https://YOUR_KEY@api.cuped.io">
 *   <App />
 * </CupedProvider>
 * ```
 *
 * **Zero-flash SSR.** Combine with `@cuped-io/flame-edge` middleware
 * and pass the resolved cookie payload as `prehydrated`:
 *
 * ```tsx
 * <CupedProvider dsn={...} prehydrated={prehydratedFromCookie}>
 *   <App />
 * </CupedProvider>
 * ```
 *
 * Without `prehydrated`, the provider is a no-op on the server and
 * components default to the control variant until the client
 * hydrates and `flame.init()` resolves.
 */
export function CupedProvider({
  children,
  flame: flameOverride,
  prehydrated,
  ...flameConfig
}: CupedProviderProps) {
  const flame = flameOverride ?? defaultFlame;

  // Synchronous map populated from prehydrated. Available on first
  // render — including server render — so useExperiment can return
  // the right variant before any effects fire.
  const initialAssignments = useMemo(
    () => resolveAssignmentsFromPrehydrated(prehydrated),
    [prehydrated]
  );

  // With prehydrated state we're effectively initialized from the
  // start; without it, we defer to flame.isInitialized().
  const [initialized, setInitialized] = useState(
    () => Boolean(prehydrated) || flame.isInitialized()
  );
  const [assignments, setAssignments] = useState<Record<string, Variant>>(initialAssignments);
  // Bumped after init resolves so consumers re-evaluate.
  const [initTick, setInitTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (flame.isInitialized()) {
      setInitialized(true);
      setInitTick((t) => t + 1);
      return () => {
        cancelled = true;
      };
    }

    flame
      .init({ ...flameConfig, prehydrated })
      .then(() => {
        if (cancelled) return;
        setInitialized(true);
        setInitTick((t) => t + 1);
      })
      .catch((err: unknown) => {
        console.error('[CupedProvider] flame.init failed:', err);
        if (cancelled) return;
        setInitialized(true);
        setInitTick((t) => t + 1);
      });

    return () => {
      cancelled = true;
    };
    // Mount-once init — see v0.1 commit message for rationale.
  }, [flame]);

  // Keep the prehydrated map fresh when the prop changes (rare, but
  // it could happen if the parent re-resolves the cookie on
  // navigation). React-only state; doesn't re-trigger flame.init.
  useEffect(() => {
    setAssignments(initialAssignments);
  }, [initialAssignments]);

  const value = useMemo<CupedContextValue>(
    () => ({ flame, initialized, initTick, assignments }),
    [flame, initialized, initTick, assignments]
  );

  return <CupedContext.Provider value={value}>{children}</CupedContext.Provider>;
}
