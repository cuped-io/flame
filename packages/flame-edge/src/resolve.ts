import type { PrehydratedState } from '@cuped-io/flame';
import {
  signPrehydrated,
  verifyAndDecode,
  buildCookieHeader,
  parseCookieHeader,
  DEFAULT_COOKIE_NAME,
  DEFAULT_COOKIE_TTL_SECONDS,
} from './cookie';
import { assignVariant, fetchActiveExperiments, parseDsn } from './api';

export interface ResolveOptions {
  /** Project DSN — the value from your project's Settings → Install Snippet (e.g. `https://YOUR_KEY@api.cuped.io`). */
  dsn: string;
  /** The incoming Request (Web standard or Next.js NextRequest). */
  request: Request;
  /**
   * HMAC secret used to sign / verify the cookie. Should be a long
   * random string, kept server-side only. Rotation invalidates all
   * existing cookies (forces re-resolution on next request).
   */
  secret: string;
  /** Override the cookie name. Defaults to `cuped_state`. */
  cookieName?: string;
  /** Cookie TTL, seconds. Default 30 days. */
  cookieTtlSeconds?: number;
  /**
   * Timeout for the cuped API roundtrips during cold-resolution.
   * After this elapses, resolution returns `prehydrated: null` and
   * the React provider falls back to client-side init. Default 1500ms.
   */
  timeoutMs?: number;
  /**
   * Override `Date.now()`-based time for tests.
   */
  now?: number;
  /**
   * Override the user_id for cold-resolution. If unset, a UUIDv4 is
   * generated. Useful when the customer already has its own
   * pseudonymous id in another cookie (e.g. an analytics cookie).
   */
  userId?: string;
}

export interface ResolveResult {
  /**
   * Pre-resolved state. `null` when resolution failed (network error,
   * timeout) — the caller should still serve the page; the React
   * provider will fall back to its v0.1 client-side init.
   */
  prehydrated: PrehydratedState | null;
  /**
   * Set-Cookie header value to attach to the response, or `undefined`
   * when the request already had a valid cookie and nothing changed.
   */
  setCookie?: string;
}

function genUserId(): string {
  // crypto.randomUUID is in the Web Crypto API; available in
  // Node 19+, all modern browsers, and edge runtimes.
  return crypto.randomUUID();
}

/**
 * Resolve assignments for the incoming request.
 *
 * Behavior:
 * 1. If a valid signed cookie is present, decode and return.
 * 2. Otherwise, fetch active experiments + assign the user, sign a
 *    new cookie, and return both.
 * 3. On network error / timeout / unverifiable cookie, return
 *    `{ prehydrated: null }`. The caller should still serve the
 *    response; client-side init will recover.
 */
export async function resolveAssignments(opts: ResolveOptions): Promise<ResolveResult> {
  const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
  const ttl = opts.cookieTtlSeconds ?? DEFAULT_COOKIE_TTL_SECONDS;
  const timeoutMs = opts.timeoutMs ?? 1500;

  const cookies = parseCookieHeader(opts.request.headers.get('cookie'));

  // 1. Cookie present + valid → return.
  const existing = cookies[cookieName];
  if (existing) {
    const state = await verifyAndDecode(existing, opts.secret, { now: opts.now });
    if (state) {
      return { prehydrated: state };
    }
    // Fall through: cookie is malformed/expired; replace it.
  }

  // 2. Cold resolve: hit the cuped API.
  const { apiKey, apiUrl } = parseDsn(opts.dsn);
  const userId = opts.userId ?? genUserId();
  const userIdCreatedAt = new Date((opts.now ?? Date.now() / 1000) * 1000).toISOString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const experiments = await fetchActiveExperiments({
      apiUrl,
      apiKey,
      signal: controller.signal,
    });

    // Assign in parallel.
    const assignmentEntries = await Promise.all(
      experiments.map(async (exp) => {
        try {
          const assignment = await assignVariant({
            apiUrl,
            apiKey,
            experimentId: exp.id,
            userId,
            signal: controller.signal,
          });
          return [exp.id, assignment] as const;
        } catch {
          // One bad experiment shouldn't kill the whole resolution.
          return null;
        }
      })
    );

    const assignments = Object.fromEntries(
      assignmentEntries.filter((x): x is NonNullable<typeof x> => x !== null)
    );

    const state: PrehydratedState = {
      user_id: userId,
      user_id_created_at: userIdCreatedAt,
      experiments,
      assignments,
    };

    const cookieValue = await signPrehydrated(state, opts.secret, {
      ttlSeconds: ttl,
      now: opts.now,
    });
    const setCookie = buildCookieHeader(cookieValue, { name: cookieName, ttlSeconds: ttl });

    return { prehydrated: state, setCookie };
  } catch {
    // Timed out or upstream error — let the client recover.
    return { prehydrated: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read + verify the signed prehydrated cookie from a `Cookie` header
 * (or a Next.js cookies() iterable).
 *
 * Server components use this when they need to read the same cookie
 * the middleware set, to pass to `<CupedProvider prehydrated={...}>`.
 */
export async function readPrehydratedFromCookieHeader(
  cookieHeader: string | null | undefined,
  secret: string,
  opts: { cookieName?: string; now?: number } = {}
): Promise<PrehydratedState | null> {
  const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
  const cookies = parseCookieHeader(cookieHeader);
  const value = cookies[cookieName];
  if (!value) return null;
  return verifyAndDecode(value, secret, { now: opts.now });
}
