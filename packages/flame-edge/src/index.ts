/**
 * @cuped-io/flame-edge — edge-runtime resolver + signed cookie utilities
 * for cuped.io zero-flash SSR. Use from middleware (Next.js,
 * Cloudflare Workers, Vercel Edge) and server components to populate
 * `<CupedProvider prehydrated={...}>` before render.
 *
 * ```ts
 * import { resolveAssignments } from '@cuped-io/flame-edge';
 *
 * // In middleware
 * const { prehydrated, setCookie } = await resolveAssignments({
 *   dsn: process.env.CUPED_DSN!,
 *   request,
 *   secret: process.env.CUPED_COOKIE_SECRET!,
 * });
 * ```
 */

export {
  signPrehydrated,
  verifyAndDecode,
  buildCookieHeader,
  parseCookieHeader,
  DEFAULT_COOKIE_NAME,
  DEFAULT_COOKIE_TTL_SECONDS,
  type SignedPayload,
} from './cookie';

export {
  resolveAssignments,
  readPrehydratedFromCookieHeader,
  type ResolveOptions,
  type ResolveResult,
} from './resolve';

// Re-export PrehydratedState so consumers don't need a direct
// dependency on @cuped-io/flame just for the type.
export type { PrehydratedState } from '@cuped-io/flame';
