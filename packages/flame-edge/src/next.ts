/**
 * Next.js convenience helpers for `@cuped-io/flame-edge`.
 *
 * For other frameworks (Remix, TanStack Start, Astro, raw
 * Cloudflare Workers, ...) use the framework-agnostic API in
 * `@cuped-io/flame-edge` directly.
 */

import { resolveAssignments, readPrehydratedFromCookieHeader, type ResolveOptions } from './resolve';
import { DEFAULT_COOKIE_NAME } from './cookie';
import type { PrehydratedState } from '@cuped-io/flame';

/**
 * Subset of `next/server`'s `NextResponse` we use. Typed structurally
 * so we don't take a hard dep on Next.
 */
interface NextResponseLike {
  headers: Headers;
}

export interface CupedMiddlewareConfig
  extends Omit<ResolveOptions, 'request'> {
  /**
   * Optional response factory. Defaults to creating a `NextResponse.next()`
   * via dynamic import. Override if you want to chain other middleware.
   */
  buildResponse?: () => Promise<NextResponseLike>;
}

/**
 * Build a Next.js middleware function that resolves assignments at
 * the edge and writes a signed cookie.
 *
 * ```ts
 * // middleware.ts
 * import { createCupedMiddleware } from '@cuped-io/flame-edge/next';
 *
 * export default createCupedMiddleware({
 *   dsn: process.env.CUPED_DSN!,
 *   secret: process.env.CUPED_COOKIE_SECRET!,
 * });
 *
 * export const config = {
 *   // Skip static assets and API routes.
 *   matcher: ['/((?!_next/static|_next/image|api/|favicon.ico).*)'],
 * };
 * ```
 *
 * On every matched request the middleware reads the signed cookie
 * (or fetches assignments from the cuped API if missing/expired) and writes
 * a fresh Set-Cookie header. Server components later read the same
 * cookie via {@link readPrehydratedForServerComponent}.
 */
export function createCupedMiddleware(config: CupedMiddlewareConfig) {
  return async function cupedMiddleware(request: Request): Promise<NextResponseLike> {
    const result = await resolveAssignments({ ...config, request });

    const response = config.buildResponse
      ? await config.buildResponse()
      : await defaultNextResponse();

    if (result.setCookie) {
      response.headers.set('Set-Cookie', result.setCookie);
    }
    return response;
  };
}

/**
 * Read the prehydrated cookie from Next.js's `cookies()` API (App
 * Router server components).
 *
 * ```ts
 * import { cookies } from 'next/headers';
 * import { readPrehydratedForServerComponent } from '@cuped-io/flame-edge/next';
 *
 * export default async function Layout({ children }) {
 *   const prehydrated = await readPrehydratedForServerComponent(
 *     await cookies(),
 *     process.env.CUPED_COOKIE_SECRET!
 *   );
 *   return (
 *     <CupedProvider dsn={...} prehydrated={prehydrated ?? undefined}>
 *       {children}
 *     </CupedProvider>
 *   );
 * }
 * ```
 */
export async function readPrehydratedForServerComponent(
  cookieStore: { get(name: string): { value: string } | undefined },
  secret: string,
  opts: { cookieName?: string; now?: number } = {}
): Promise<PrehydratedState | null> {
  const name = opts.cookieName ?? DEFAULT_COOKIE_NAME;
  const entry = cookieStore.get(name);
  if (!entry) return null;
  // Reuse the cookie-header parser for consistency: synthesize a
  // minimal header so the same code path validates.
  return readPrehydratedFromCookieHeader(`${name}=${entry.value}`, secret, opts);
}

async function defaultNextResponse(): Promise<NextResponseLike> {
  // Dynamic import so this file doesn't pull in next/server when
  // tree-shaken into a non-Next bundle. `next` is an optional peer
  // dep, so the import resolves at runtime only in customer apps
  // that have it installed.
  const mod = await import('next/server');
  return mod.NextResponse.next();
}
