import type { Variant } from '@cuped-io/flame';

/**
 * Result of `useExperiment(key)`.
 *
 * `variant` is the variant to show (id, name, is_control), or `null`
 * for control: flame does not know the experiment, the visitor gets
 * control, or the loading limit passed first.
 *
 * `isLoading` is true only while flame learns a new visitor's arm, and
 * never longer than the provider's `loadingLimitMs` (default 200 ms).
 * Use it to render a skeleton or default content meanwhile.
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
