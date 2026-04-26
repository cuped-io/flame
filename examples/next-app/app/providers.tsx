'use client';

import { CupedProvider } from '@cuped-io/flame-react';
import type { PrehydratedState } from '@cuped-io/flame';

/**
 * Client-component wrapper around CupedProvider. Server components
 * can't use React context directly; they pass the resolved
 * prehydrated state in as a prop.
 */
export function Providers({
  children,
  prehydrated,
}: {
  children: React.ReactNode;
  prehydrated?: PrehydratedState;
}) {
  return (
    <CupedProvider
      dsn={process.env.NEXT_PUBLIC_CUPED_DSN!}
      prehydrated={prehydrated}
      debug
    >
      {children}
    </CupedProvider>
  );
}
