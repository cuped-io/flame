import type { Experiment, PrehydratedState, StoredAssignment } from '@cuped-io/flame';
import { pickArms, type RulesExperiment, type RulesFile } from '@cuped-io/flame/rules';
import {
  signVisitor,
  verifyVisitor,
  variantToken,
  type Visitor,
  buildCookieHeader,
  parseCookieHeader,
  DEFAULT_COOKIE_NAME,
  DEFAULT_COOKIE_TTL_SECONDS,
} from './cookie';
import { parseDsn } from './dsn';
import { cachedRules } from './rules-cache';

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
   * Keeps the runtime alive for the background rules refresh after the
   * response is sent: pass your runtime's `waitUntil` (Next.js middleware's
   * `event.waitUntil`, Cloudflare's `ctx.waitUntil`). Without it the refresh
   * still starts, but a runtime that freezes after the response may not
   * finish it.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Override `Date.now()`-based time for tests.
   */
  now?: number;
  /**
   * Override the user_id for a new visitor. If unset, a UUIDv4 is
   * generated. Useful when the customer already has its own
   * pseudonymous id in another cookie (e.g. an analytics cookie).
   */
  userId?: string;
}

export interface ResolveResult {
  /**
   * Pre-resolved state. `null` when this runtime has no rules copy yet:
   * the caller should still serve the page, and the browser picks.
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
 * Resolve assignments for the incoming request (flame#62).
 *
 * Arms are picked here, from this runtime's copy of the project's rules
 * file, with flame's own pick and Holdout draw. A request never waits on
 * ember: the copy is refreshed in the background about once a minute.
 *
 * - No rules copy yet: `{ prehydrated: null }`, and the cookie is left as it
 *   is. The browser picks.
 * - Otherwise the visitor's arms are reconciled with the copy: a new running
 *   experiment gets an arm, a stopped one drops out, an arm already held
 *   stays. A new visitor gets an id. The cookie is re-signed when the arms
 *   changed.
 *
 * Writes no assignment: the page that delivers an arm records it
 * (flame#47), so a visitor is never counted in an experiment they never saw.
 *
 * A held-out visitor is left out of `assignments`, so the original renders,
 * unrecorded.
 */
export async function resolveAssignments(opts: ResolveOptions): Promise<ResolveResult> {
  const cookieName = opts.cookieName ?? DEFAULT_COOKIE_NAME;
  const ttl = opts.cookieTtlSeconds ?? DEFAULT_COOKIE_TTL_SECONDS;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const { apiKey, apiUrl } = parseDsn(opts.dsn);
  const rules = cachedRules({ apiUrl, apiKey, nowMs: now * 1000, waitUntil: opts.waitUntil });

  const existing = parseCookieHeader(opts.request.headers.get('cookie'))[cookieName];
  const visitor = existing ? await verifyVisitor(existing, opts.secret, { now }) : null;
  if (!rules) return { prehydrated: null };

  const { state, signed } = await reconcile(
    rules,
    visitor ?? { id: opts.userId ?? genUserId(), since: now, arms: [] },
    now
  );
  if (visitor && !visitor.legacy && sameArms(visitor.arms, signed.arms)) {
    return { prehydrated: state };
  }
  const cookieValue = await signVisitor(signed, opts.secret, { ttlSeconds: ttl, now });
  return {
    prehydrated: state,
    setCookie: buildCookieHeader(cookieValue, { name: cookieName, ttlSeconds: ttl }),
  };
}

/**
 * The visitor's arms under `rules`, as the state flame#24 accepts and as the
 * visitor to sign. Each running experiment keeps the arm the visitor has,
 * else gets flame's pick; experiments no longer running drop out.
 */
async function reconcile(
  rules: RulesFile,
  visitor: Visitor,
  now: number
): Promise<{ state: PrehydratedState; signed: Visitor }> {
  const held = new Set(visitor.arms);
  const assignedAt = new Date(now * 1000).toISOString();
  const assignment = (experimentId: string, variantId: string): StoredAssignment => ({
    experimentId,
    variantId,
    userId: visitor.id,
    assignedAt,
  });

  const saved: Record<string, StoredAssignment> = {};
  const tokens = new Map<string, string>();
  for (const experiment of rules.experiments) {
    const matches: string[] = [];
    for (const variant of experiment.variants) {
      const token = await variantToken(variant.id);
      tokens.set(variant.id, token);
      if (held.has(token)) matches.push(variant.id);
    }
    // Two of its variants sharing a token: which one is held is unknown, so
    // the visitor is picked again.
    if (matches.length === 1) saved[experiment.id] = assignment(experiment.id, matches[0]);
  }

  // A Holdout member's control is never recorded, so it is left out: flame
  // shows control, unrecorded. Promoted winners are left out too: flame#24's
  // edge state has no place for them, as before flame#62.
  const running = new Set(rules.experiments.map((e) => e.id));
  const assignments: Record<string, StoredAssignment> = {};
  const armTokens: string[] = [];
  for (const arm of await pickArms(rules, visitor.id, saved)) {
    if (!arm.exposure || !running.has(arm.experimentId)) continue;
    assignments[arm.experimentId] = assignment(arm.experimentId, arm.variant.id);
    armTokens.push(tokens.get(arm.variant.id)!);
  }

  return {
    state: {
      user_id: visitor.id,
      user_id_created_at: new Date(visitor.since * 1000).toISOString(),
      experiments: rules.experiments.map(toExperiment),
      assignments,
    },
    signed: { ...visitor, arms: armTokens },
  };
}

/** A rules-file experiment as flame's edge read takes it. */
function toExperiment(experiment: RulesExperiment): Experiment {
  return {
    id: experiment.id,
    slug: experiment.slug,
    url_pattern: experiment.url_pattern,
    variants: experiment.variants.map((v) => ({ ...v, experiment_id: experiment.id })),
    // The rules file carries none of these, and flame's read uses none.
    project_id: '',
    name: experiment.slug,
    description: null,
    status: 'running',
    created_at: '',
    updated_at: '',
  };
}

function sameArms(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((token) => b.includes(token));
}

/**
 * Read the signed cookie from a `Cookie` header and give the state to pass
 * to `<CupedProvider prehydrated={...}>`, from this runtime's rules copy.
 *
 * Server components use this to render with the same arms the middleware
 * signed. `null` with no valid cookie, or no rules copy yet in this runtime.
 * Never waits on ember.
 */
export async function readPrehydratedFromCookieHeader(
  cookieHeader: string | null | undefined,
  opts: {
    dsn: string;
    secret: string;
    cookieName?: string;
    now?: number;
    waitUntil?: (promise: Promise<unknown>) => void;
  }
): Promise<PrehydratedState | null> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const { apiKey, apiUrl } = parseDsn(opts.dsn);
  const rules = cachedRules({ apiUrl, apiKey, nowMs: now * 1000, waitUntil: opts.waitUntil });
  const value = parseCookieHeader(cookieHeader)[opts.cookieName ?? DEFAULT_COOKIE_NAME];
  const visitor = value ? await verifyVisitor(value, opts.secret, { now }) : null;
  if (!visitor || !rules) return null;
  return (await reconcile(rules, visitor, now)).state;
}
