import type { PrehydratedState } from '@cuped-io/flame';

/**
 * Wire shape of the signed cookie payload.
 *
 * `state` is the {@link PrehydratedState} consumed by flame's
 * `init()` and forwarded by the React SDK. The cookie is a
 * base64url-encoded JSON of this object plus a base64url HMAC,
 * separated by a `.`:
 *
 *     <base64url(JSON.stringify(payload))>.<base64url(hmac)>
 */
export interface SignedPayload {
  /** Format version. Bump when the wire shape changes. */
  v: 1;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expires-at, seconds since epoch. */
  exp: number;
  /** The data flame.init consumes. */
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
 * Sign a {@link PrehydratedState} into a cookie value.
 *
 * Returns the string to set as the cookie's value (no encoding
 * concerns — base64url is cookie-safe).
 */
export async function signPrehydrated(
  state: PrehydratedState,
  secret: string,
  opts: { ttlSeconds?: number; now?: number } = {}
): Promise<string> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? DEFAULT_COOKIE_TTL_SECONDS;
  const payload: SignedPayload = {
    v: 1,
    iat: now,
    exp: now + ttl,
    state,
  };
  const json = encoder.encode(JSON.stringify(payload));
  const key = await importHmacKey(secret, 'sign');
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, json));
  return `${base64UrlEncode(json)}.${base64UrlEncode(sig)}`;
}

/**
 * Verify and decode a cookie value into a {@link PrehydratedState}.
 *
 * Returns `null` if the cookie is malformed, the signature doesn't
 * match the secret, or the payload has expired. Never throws on
 * tamper — just returns null so the caller treats it as "no cookie."
 */
export async function verifyAndDecode(
  cookieValue: string,
  secret: string,
  opts: { now?: number } = {}
): Promise<PrehydratedState | null> {
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

  let parsed: SignedPayload;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes)) as SignedPayload;
  } catch {
    return null;
  }
  if (parsed.v !== 1) return null;
  if (parsed.exp < now) return null;
  return parsed.state;
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
