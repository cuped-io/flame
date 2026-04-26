import { type ReactNode } from 'react';
import { useExperiment } from './useExperiment';
import type { VariantsMap } from './types';

export interface ExperimentProps {
  /** The experiment ID to look up. */
  id: string;
  /**
   * Map of variant *name* → element to render.
   *
   * Conventionally includes a `control` key. Other keys match the
   * variant names configured in the cuped dashboard.
   */
  variants: VariantsMap;
  /**
   * What to render while the SDK is still initializing or if there's
   * no assignment yet. Defaults to `variants.control` if present, else `null`.
   */
  fallback?: ReactNode;
}

/**
 * Declarative variant rendering.
 *
 * ```tsx
 * <Experiment id="hero-cta" variants={{
 *   control: <Button color="blue">Get started</Button>,
 *   green:   <Button color="green">Save 30%</Button>,
 * }} fallback={<Skeleton />} />
 * ```
 *
 * Picks the entry from `variants` whose key matches the assigned
 * variant's name. While loading, renders `fallback` if given,
 * otherwise the `control` entry, otherwise null.
 */
export function Experiment({ id, variants, fallback }: ExperimentProps) {
  const { variant, isLoading } = useExperiment(id);

  if (isLoading || !variant) {
    if (fallback !== undefined) return <>{fallback}</>;
    return <>{variants.control ?? null}</>;
  }

  const matched = variants[variant.name];
  if (matched !== undefined) return <>{matched}</>;

  // Assignment exists but no entry in `variants` for that name —
  // fall through to control.
  return <>{variants.control ?? null}</>;
}
