/**
 * @cuped-io/flame-react — React bindings for the cuped.io A/B testing
 * SDK. Wraps `@cuped-io/flame` in a provider + hooks pattern so React
 * apps can branch on assigned variants in code instead of fighting
 * with selector-based DOM mutations.
 *
 * ```tsx
 * // App entry
 * import { CupedProvider } from '@cuped-io/flame-react';
 *
 * <CupedProvider dsn="https://YOUR_KEY@api.cuped.io">
 *   <App />
 * </CupedProvider>
 *
 * // Anywhere below the provider
 * import { useExperiment } from '@cuped-io/flame-react';
 *
 * function HeroCTA() {
 *   const { variant, isLoading } = useExperiment('hero-cta');
 *   if (isLoading) return <Skeleton />;
 *   return variant?.name === 'green' ? <GreenCTA /> : <BlueCTA />;
 * }
 * ```
 *
 * For zero-flash SSR (variant resolved server-side, no control flash
 * during hydration), pair this package with `@cuped-io/flame-edge` and
 * pass its prehydrated state to `<CupedProvider>`.
 */

export { CupedProvider, type CupedProviderProps } from './provider';
export { useExperiment } from './useExperiment';
export { Experiment, type ExperimentProps } from './Experiment';
export { useObserve } from './useObserve';
export type { UseExperimentResult, VariantsMap } from './types';
