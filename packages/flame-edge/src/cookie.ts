import type { PrehydratedState } from '@cuped-io/flame';

/**
 * Who the visitor is and which arms they have (flame#62). This is all the
 * cookie holds: the experiments come from the edge's rules copy, so the
 * cookie stays small however many run.
 */
export interface Visitor {
  /** The id flame picks and records with. */
  id: string;
  /** When the id was issued, seconds since epoch (for CUPED eligibility). */
  since: number;
  /** One {@link variantToken} per arm the visitor has. */
  arms: string[];
}

/**
 * Wire shape of the signed cookie payload. The cookie is a base64url JSON
 * of this object plus a base64url HMAC, separated by a `.`:
 *
 *     <base64url(JSON.stringify(payload))>.<base64url(hmac)>
 */
export interface SignedPayload {
  /** Format version. Bump when the wire shape changes. */
  v: 2;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expires-at, seconds since epoch. */
  exp: number;
  /** Visitor id. */
  vid: string;
  /** {@link Visitor.since}. */
  since: number;
  /** {@link Visitor.arms}. */
  arms: string[];
}

/** The payload flame-edge signed before flame#62. Read once, then re-signed. */
interface LegacyPayload {
  v: 1;
  iat: number;
  exp: number;
  state: PrehydratedState;
}

/** Default cookie name. */
export const DEFAULT_COOKIE_NAME = 'cuped_state';
/** Default cookie TTL, seconds (30 days). */
export const DEFAULT_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** RFC 4648 base64url (no padding). */
function base64UrlEncode(bytes: Uint8Array): string {
  // btoa works on binary strings; we feed it our bytes one char at a
  // time. Safe for arbitrary lengths because we don't allocate a
  // potentially-megabytes-long string.
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importHmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

/**
 * Constant-time-ish array equality. Web Crypto's `verify` does the
 * actual comparison securely; this is a fallback for the rare case
 * where we're inspecting raw bytes.
 */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a[i] ^ b[i];
  return acc === 0;
}

/**
 * A variant's mark in the cookie: the first 8 base64url characters (48 bits)
 * of SHA-256 of its id. A full id would put 20 arms over 1 KB. Two of a
 * project's variants sharing a token is vanishingly unlikely, and costs only
 * a re-pick, which is deterministic and lands on the same arm unless the
 * weights changed.
 */
export async function variantToken(variantId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(variantId)));
  return base64UrlEncode(digest).slice(0, 8);
}

/**
 * Sign a {@link Visitor} into a cookie value.
 *
 * Returns the string to set as the cookie's value (no encoding
 * concerns — base64url is cookie-safe).
 */
export async function signVisitor(
  visitor: Visitor,
  secret: string,
  opts: { ttlSeconds?: number; now?: number } = {}
): Promise<string> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? DEFAULT_COOKIE_TTL_SECONDS;
  const payload: SignedPayload = {
    v: 2,
    iat: now,
    exp: now + ttl,
    vid: visitor.id,
    since: visitor.since,
    arms: visitor.arms,
  };
  const json = encoder.encode(JSON.stringify(payload));
  const key = await importHmacKey(secret, 'sign');
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, json));
  return `${base64UrlEncode(json)}.${base64UrlEncode(sig)}`;
}

/**
 * Verify and decode a cookie value into a {@link Visitor}.
 *
 * Returns `null` if the cookie is malformed, the signature doesn't
 * match the secret, or the payload has expired. Never throws on
 * tamper — just returns null so the caller treats it as "no cookie."
 *
 * A cookie signed before flame#62 keeps its visitor and arms. `legacy`
 * marks it, so the caller re-signs it in the new shape.
 */
export async function verifyVisitor(
  cookieValue: string,
  secret: string,
  opts: { now?: number } = {}
): Promise<(Visitor & { legacy?: true }) | null> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const dot = cookieValue.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);
  if (!payloadB64 || !sigB64) return null;

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(payloadB64);
    sigBytes = base64UrlDecode(sigB64);
  } catch {
    return null;
  }

  // We use crypto.subtle.verify rather than recomputing-and-comparing
  // ourselves because it's intended to be timing-safe. The
  // BufferSource cast is needed because TS 5.7 narrowed Uint8Array's
  // buffer type to include SharedArrayBuffer; runtime is unchanged.
  const key = await importHmacKey(secret, 'verify');
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes as BufferSource,
      payloadBytes as BufferSource
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let parsed: SignedPayload | LegacyPayload;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes)) as SignedPayload | LegacyPayload;
  } catch {
    return null;
  }
  if (typeof parsed?.exp !== 'number' || parsed.exp < now) return null;
  if (parsed.v === 2) {
    if (typeof parsed.vid !== 'string' || !Array.isArray(parsed.arms)) return null;
    const since = typeof parsed.since === 'number' ? parsed.since : parsed.iat;
    return { id: parsed.vid, since, arms: parsed.arms };
  }
  if (parsed.v === 1 && typeof parsed.state?.user_id === 'string') {
    const { state } = parsed;
    const created = state.user_id_created_at ? Date.parse(state.user_id_created_at) : NaN;
    const variantIds = Object.values(state.assignments ?? {})
      .map((a) => a?.variantId)
      .filter((id): id is string => typeof id === 'string');
    return {
      id: state.user_id,
      since: Number.isNaN(created) ? parsed.iat : Math.floor(created / 1000),
      arms: await Promise.all(variantIds.map(variantToken)),
      legacy: true,
    };
  }
  return null;
}

/**
 * Build a Set-Cookie header value for a freshly-signed prehydrated
 * cookie.
 *
 * Defaults to `Path=/; SameSite=Lax; HttpOnly=false; Secure=true`
 * (so JS in the browser can read it for hydration if needed) and a
 * 30-day Max-Age. Override via `attrs`.
 */
export function buildCookieHeader(
  cookieValue: string,
  opts: {
    name?: string;
    ttlSeconds?: number;
    attrs?: { domain?: string; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' };
  } = {}
): string {
  const name = opts.name ?? DEFAULT_COOKIE_NAME;
  const maxAge = opts.ttlSeconds ?? DEFAULT_COOKIE_TTL_SECONDS;
  const parts = [`${name}=${cookieValue}`, `Path=/`, `Max-Age=${maxAge}`];
  parts.push(`SameSite=${opts.attrs?.sameSite ?? 'Lax'}`);
  if (opts.attrs?.secure ?? true) parts.push('Secure');
  if (opts.attrs?.domain) parts.push(`Domain=${opts.attrs.domain}`);
  return parts.join('; ');
}

/**
 * Parse a `Cookie` header into a name → value map.
 *
 * Tolerant of malformed entries (skips them rather than throwing).
 */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

// Internal helpers exported for tests.
export const __internal = { base64UrlEncode, base64UrlDecode, bytesEqual };
