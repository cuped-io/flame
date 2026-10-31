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

/** Subset of `next/server`'s `NextFetchEvent`, the middleware's second argument. */
interface NextFetchEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

/** What `NextResponse.next()` takes to pass changed request headers to the render. */
export interface NextResponseInit {
  request: { headers: Headers };
}

export interface CupedMiddlewareConfig extends Omit<ResolveOptions, 'request' | 'waitUntil'> {
  /**
   * Optional response factory. Defaults to `NextResponse.next(init)`
   * via dynamic import. Override if you want to chain other middleware;
   * pass `init` on to `NextResponse.next(init)` so a cookie signed on this
   * request reaches the server render.
   */
  buildResponse?: (init: NextResponseInit) => Promise<NextResponseLike>;
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
 * On every matched request the middleware picks the visitor's arms from
 * its rules copy (never waiting on the cuped API) and writes Set-Cookie when
 * they changed. A newly signed cookie is also put on the request it passes
 * on, so server components reading it via
 * {@link readPrehydratedForServerComponent} render the same arms on this
 * very request.
 */
export function createCupedMiddleware(config: CupedMiddlewareConfig) {
  return async function cupedMiddleware(
    request: Request,
    event?: NextFetchEventLike
  ): Promise<NextResponseLike> {
    const result = await resolveAssignments({
      ...config,
      request,
      waitUntil: event ? (promise) => event.waitUntil(promise) : undefined,
    });

    const headers = new Headers(request.headers);
    if (result.setCookie) {
      const name = config.cookieName ?? DEFAULT_COOKIE_NAME;
      const pair = result.setCookie.split(';')[0];
      const others = (request.headers.get('cookie') ?? '')
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith(`${name}=`));
      headers.set('cookie', [...others, pair].join('; '));
    }
    const init = { request: { headers } };
    const response = config.buildResponse
      ? await config.buildResponse(init)
      : await defaultNextResponse(init);

    if (result.setCookie) {
      response.headers.set('Set-Cookie', result.setCookie);
    }
    return response;
  };
}

/**
 * Read the prehydrated state from Next.js's `cookies()` API (App
 * Router server components).
 *
 * ```ts
 * import { cookies } from 'next/headers';
 * import { readPrehydratedForServerComponent } from '@cuped-io/flame-edge/next';
 *
 * export default async function Layout({ children }) {
 *   const prehydrated = await readPrehydratedForServerComponent(await cookies(), {
 *     dsn: process.env.CUPED_DSN!,
 *     secret: process.env.CUPED_COOKIE_SECRET!,
 *   });
 *   return (
 *     <CupedProvider dsn={...} prehydrated={prehydrated ?? undefined}>
 *       {children}
 *     </CupedProvider>
 *   );
 * }
 * ```
 *
 * The experiments come from this runtime's rules copy, not the cookie.
 * `null` until the runtime has one, which it fetches in the background.
 */
export async function readPrehydratedForServerComponent(
  cookieStore: { get(name: string): { value: string } | undefined },
  opts: { dsn: string; secret: string; cookieName?: string; now?: number }
): Promise<PrehydratedState | null> {
  const name = opts.cookieName ?? DEFAULT_COOKIE_NAME;
  const entry = cookieStore.get(name);
  // Reuse the cookie-header parser for consistency: synthesize a
  // minimal header so the same code path validates.
  return readPrehydratedFromCookieHeader(entry ? `${name}=${entry.value}` : null, opts);
}

async function defaultNextResponse(init: NextResponseInit): Promise<NextResponseLike> {
  // Dynamic import so this file doesn't pull in next/server when
  // tree-shaken into a non-Next bundle. `next` is an optional peer
  // dep, so the import resolves at runtime only in customer apps
  // that have it installed.
  const mod = await import('next/server');
  return mod.NextResponse.next(init);
}
