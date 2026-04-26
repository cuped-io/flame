import type { Variant } from '@cuped-io/flame';

/**
 * Result of `useExperiment(experimentId)`.
 *
 * `variant` is the full {@link Variant} object (id, name, is_control,
 * changes) once the SDK has resolved an assignment, or `null` while
 * the SDK is still initializing or if no assignment exists.
 *
 * `isLoading` is true until the underlying flame instance has
 * finished `init()`. Use it to render a skeleton or default content
 * during the initial fetch.
 */
export interface UseExperimentResult {
  variant: Variant | null;
  isLoading: boolean;
}

/**
 * Variant-name → React element mapping passed to `<Experiment>`.
 *
 * Conventionally includes a `control` key. Other keys match the
 * variant names you configured in the cuped dashboard.
 */
export type VariantsMap = Record<string, React.ReactNode>;
