import type { PrehydratedState, StoredAssignment } from '@cuped-io/flame';
import {
  signPrehydrated,
  verifyAndDecode,
  verifyAndDecodePayload,
  type RetryState,
  buildCookieHeader,
  parseCookieHeader,
  DEFAULT_COOKIE_NAME,
  DEFAULT_COOKIE_TTL_SECONDS,
} from './cookie';
import { evaluateArms, fetchActiveExperiments, parseDsn, type ArmOutcome } from './api';

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
 * How long a declined assignment (event cap, archived workspace) waits
 * before the edge asks again. A cap or an archive lifts on upgrade,
 * billing reset or revive, so it must not stick for the cookie's life.
 */
const DECLINED_RETRY_SECONDS = 10 * 60;

/**
 * Resolve assignments for the incoming request.
 *
 * Behavior:
 * 1. If a valid signed cookie is present, decode and return. If it
 *    lists declined experiments whose retry time has passed, ask
 *    `/evaluate` again for just those (same user), and re-sign.
 * 2. Otherwise, fetch active experiments + evaluate the user, sign a
 *    new cookie, and return both.
 * 3. On network error / timeout / unverifiable cookie, return
 *    `{ prehydrated: null }`. The caller should still serve the
 *    response; client-side init will recover.
 *
 * Writes no assignment: the page that delivers an arm records it
 * (flame#47), so a visitor is never counted in an experiment they never saw.
 *
 * A held-out user is resolved like an assigned one: the experiment is
 * left out of `assignments`, so the original renders, and it is never
 * asked about again for the cookie's life.
 */
export async function resolveAssignments(opts: ResolveOptions): Promise<ResolveResult> {
  const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
  const ttl = opts.cookieTtlSeconds ?? DEFAULT_COOKIE_TTL_SECONDS;
  const timeoutMs = opts.timeoutMs ?? 1500;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const cookies = parseCookieHeader(opts.request.headers.get('cookie'));

  // 1. Cookie present + valid → return, unless declined ones are due a retry.
  const existing = cookies[cookieName];
  const payload = existing ? await verifyAndDecodePayload(existing, opts.secret, { now }) : null;
  if (payload && (!payload.retry || now < payload.retry.at)) {
    return { prehydrated: payload.state };
  }
  // Otherwise: no cookie, a malformed/expired one (replace it), or a
  // retry is due.

  const { apiKey, apiUrl } = parseDsn(opts.dsn);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const fetchOpts = { apiUrl, apiKey, signal: controller.signal };

  const sign = async (state: PrehydratedState, retryIds: string[]) => {
    const retry: RetryState | undefined = retryIds.length
      ? { experiment_ids: retryIds, at: now + DECLINED_RETRY_SECONDS }
      : undefined;
    const cookieValue = await signPrehydrated(state, opts.secret, { ttlSeconds: ttl, now, retry });
    return buildCookieHeader(cookieValue, { name: cookieName, ttlSeconds: ttl });
  };

  try {
    if (payload?.retry) {
      // Evaluate the same user again; only the declined experiments change.
      const { state, retry } = payload;
      const pending = retry.experiment_ids.filter((id) =>
        state.experiments.some((e) => e.id === id)
      );
      // A failed evaluation keeps serving the cookie and backs off.
      const outcomes = await evaluateArms({ ...fetchOpts, userId: state.user_id }).catch(
        () => new Map<string, ArmOutcome>()
      );
      const resolved = partitionOutcomes(pending, outcomes);
      const next: PrehydratedState = {
        ...state,
        assignments: { ...state.assignments, ...resolved.assignments },
      };
      return { prehydrated: next, setCookie: await sign(next, resolved.retry) };
    }

    // 2. Cold resolve: hit the cuped API.
    const userId = opts.userId ?? genUserId();
    const userIdCreatedAt = new Date(now * 1000).toISOString();

    const experiments = await fetchActiveExperiments(fetchOpts);
    const resolved = partitionOutcomes(
      experiments.map((e) => e.id),
      experiments.length ? await evaluateArms({ ...fetchOpts, userId }) : new Map()
    );

    const state: PrehydratedState = {
      user_id: userId,
      user_id_created_at: userIdCreatedAt,
      experiments,
      assignments: resolved.assignments,
    };
    return { prehydrated: state, setCookie: await sign(state, resolved.retry) };
  } catch {
    // Timed out or upstream error — let the client recover.
    return { prehydrated: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Split each experiment's `/evaluate` outcome into the cookie's arms and
 * retries. Held-out experiments are left out of `assignments` for good;
 * declined ones, and any ember left out of its answer, are left out too but
 * listed in `retry`, to ask about again later.
 */
function partitionOutcomes(
  experimentIds: string[],
  outcomes: Map<string, ArmOutcome>
): { assignments: Record<string, StoredAssignment>; retry: string[] } {
  const assignments: Record<string, StoredAssignment> = {};
  const retry: string[] = [];
  for (const experimentId of experimentIds) {
    const outcome = outcomes.get(experimentId);
    if (outcome?.kind === 'assigned') {
      assignments[experimentId] = outcome.assignment;
    } else if (outcome?.kind !== 'held_out') {
      retry.push(experimentId);
    }
  }
  return { assignments, retry };
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
