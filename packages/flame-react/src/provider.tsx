import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  flame as defaultFlame,
  type Flame,
  type FlameConfig,
  type PrehydratedState,
  type Variant,
} from '@cuped-io/flame';
import { earlyArms } from '@cuped-io/flame/rules';
import { CupedContext, type CupedContextValue } from './context';

/** How long `useExperiment` may report `isLoading` by default (flame#61). */
const DEFAULT_LOADING_LIMIT_MS = 200;

// For useSyncExternalStore: whether this render is a hydration. Nothing
// changes it, so nothing subscribes.
const subscribeNever = () => () => {};
const notHydrating = () => false;
const isHydrating = () => true;

export interface CupedProviderProps extends FlameConfig {
  children: ReactNode;

  /**
   * Pre-resolved assignments + experiments, produced at the edge by
   * `@cuped-io/flame-edge`. When supplied, the provider:
   *
   * 1. Renders the correct variant on the very first server render
   *    (no flash, no hydration mismatch).
   * 2. Forwards the state to `flame.init()`, so flame needs no rules
   *    file for this visitor.
   *
   * Without this prop, the server render reports `isLoading`, and the
   * client waits up to `loadingLimitMs` for flame to learn the arms.
   */
  prehydrated?: PrehydratedState;

  /**
   * How long `useExperiment` may report `isLoading` while flame learns a
   * new visitor's arms, in milliseconds (flame#61). Default 200. When the limit
   * passes first, those experiments show control for the rest of the page
   * view and nothing is recorded, even if the arms arrive later. `0` means
   * never wait: control at once unless the arm is already known.
   */
  loadingLimitMs?: number;

  /**
   * Override the underlying flame instance.
   *
   * Defaults to the singleton exported from `@cuped-io/flame`. Override
   * mainly for tests; production apps should use the singleton so
   * everything (auto-tracking, identity, event queue) shares
   * one instance.
   */
  flame?: Flame;
}

/**
 * The flame-edge answer as a synchronous map from experiment id and slug
 * to the variant to show. It gives what flame's read gives once ready: the
 * assigned variant, or control for an experiment the answer leaves out.
 */
function edgeVariants(state: PrehydratedState | undefined): Record<string, Variant> | null {
  if (!state) return null;
  const result: Record<string, Variant> = {};
  for (const experiment of state.experiments) {
    const variants = experiment.variants ?? [];
    const variantId = state.assignments[experiment.id]?.variantId;
    const variant = variants.find((v) => v.id === variantId) ?? variants.find((v) => v.is_control);
    if (!variant) continue;
    result[experiment.id] = variant;
    if (experiment.slug) result[experiment.slug] = variant;
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
 * Without `prehydrated`, the server render reports `isLoading` (or
 * control, with `loadingLimitMs={0}`), and the client waits up to
 * `loadingLimitMs` for flame to learn the visitor's arms.
 *
 * **Returning visitors.** On a render that is not a hydration, a
 * returning visitor's saved arm is there at once, from flame's stored
 * rules file (flame#65). A hydration gives what the server render gave,
 * so a server-rendered page uses `prehydrated` to avoid the loading
 * render.
 */
export function CupedProvider({
  children,
  flame: flameOverride,
  prehydrated,
  loadingLimitMs = DEFAULT_LOADING_LIMIT_MS,
  ...flameConfig
}: CupedProviderProps) {
  const flame = flameOverride ?? defaultFlame;

  // Available on the first render, including the server render, so
  // useExperiment can answer before any effect runs.
  const edge = useMemo(() => edgeVariants(prehydrated), [prehydrated]);

  // A hydration gives what the server render gave: no early answer, and
  // not ready. React renders again with the browser's values right after.
  const hydrating = useSyncExternalStore(subscribeNever, notHydrating, isHydrating);
  const { dsn, requireConsent } = flameConfig;
  const early = useMemo(
    () => (hydrating || edge ? null : earlyArms({ dsn, requireConsent })),
    [hydrating, edge, dsn, requireConsent]
  );

  const [initDone, setInitDone] = useState(() => flame.isInitialized());
  const ready = initDone && !hydrating;
  const [timedOut, setTimedOut] = useState(() => loadingLimitMs <= 0);
  // Mutated during render by the hooks that give up. Each key is added at
  // most once and never removed, so a repeated render changes nothing.
  const gaveUp = useRef(new Set<string>()).current;
  // Strict Mode runs the effect twice: the second run joins the first init.
  const init = useRef<Promise<void> | null>(null);

  useEffect(() => {
    if (ready || timedOut) return;
    const timer = setTimeout(() => setTimedOut(true), loadingLimitMs);
    return () => clearTimeout(timer);
  }, [ready, timedOut, loadingLimitMs]);

  useEffect(() => {
    let cancelled = false;

    if (flame.isInitialized()) {
      setInitDone(true);
      return;
    }

    init.current ??= flame.init({ ...flameConfig, prehydrated }).catch((err: unknown) => {
      console.error('[CupedProvider] flame.init failed:', err);
    });
    void init.current.then(() => {
      // After a failed init, flame's reads answer null: control.
      if (!cancelled) setInitDone(true);
    });

    return () => {
      cancelled = true;
    };
    // Mount-once init — see v0.1 commit message for rationale.
  }, [flame]);

  const value = useMemo<CupedContextValue>(
    () => ({ flame, ready, edge, early, timedOut, gaveUp }),
    [flame, ready, edge, early, timedOut, gaveUp]
  );

  return <CupedContext.Provider value={value}>{children}</CupedContext.Provider>;
}
