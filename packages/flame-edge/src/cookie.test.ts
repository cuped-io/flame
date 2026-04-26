import { describe, it, expect } from 'vitest';
import {
  signPrehydrated,
  verifyAndDecode,
  buildCookieHeader,
  parseCookieHeader,
  DEFAULT_COOKIE_NAME,
} from './cookie';
import type { PrehydratedState } from '@cuped-io/flame';

const SECRET = 'test-secret-please-do-not-use-in-prod';

const sample: PrehydratedState = {
  user_id: 'user-1',
  experiments: [],
  assignments: {},
};

describe('cookie sign/verify', () => {
  it('roundtrips a payload through sign + verify', async () => {
    const cookie = await signPrehydrated(sample, SECRET);
    const decoded = await verifyAndDecode(cookie, SECRET);
    expect(decoded).toEqual(sample);
  });

  it('rejects a tampered payload', async () => {
    const cookie = await signPrehydrated(sample, SECRET);
    // Flip a single byte in the payload section.
    const dot = cookie.indexOf('.');
    const bad = cookie.slice(0, dot - 1) + 'X' + cookie.slice(dot);
    const decoded = await verifyAndDecode(bad, SECRET);
    expect(decoded).toBeNull();
  });

  it('rejects a payload signed with a different secret', async () => {
    const cookie = await signPrehydrated(sample, SECRET);
    const decoded = await verifyAndDecode(cookie, 'different-secret');
    expect(decoded).toBeNull();
  });

  it('rejects an expired cookie', async () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const cookie = await signPrehydrated(sample, SECRET, {
      now: tenMinutesAgo,
      ttlSeconds: 60, // expired 9 minutes ago
    });
    const decoded = await verifyAndDecode(cookie, SECRET);
    expect(decoded).toBeNull();
  });

  it('rejects a malformed cookie (no dot)', async () => {
    expect(await verifyAndDecode('no-signature-section', SECRET)).toBeNull();
  });

  it('rejects an empty cookie', async () => {
    expect(await verifyAndDecode('', SECRET)).toBeNull();
  });

  it('rejects a cookie with non-base64 payload', async () => {
    expect(await verifyAndDecode('!!!.???', SECRET)).toBeNull();
  });
});

describe('buildCookieHeader', () => {
  it('uses sane defaults', () => {
    const header = buildCookieHeader('abc.def');
    expect(header).toContain(`${DEFAULT_COOKIE_NAME}=abc.def`);
    expect(header).toContain('Path=/');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Secure');
    expect(header).toContain('Max-Age=');
  });

  it('respects custom name + ttl', () => {
    const header = buildCookieHeader('xyz', { name: 'custom', ttlSeconds: 60 });
    expect(header).toContain('custom=xyz');
    expect(header).toContain('Max-Age=60');
  });

  it('drops Secure when explicitly disabled', () => {
    const header = buildCookieHeader('xyz', { attrs: { secure: false } });
    expect(header).not.toContain('Secure');
  });
});

describe('parseCookieHeader', () => {
  it('parses a single cookie', () => {
    expect(parseCookieHeader('foo=bar')).toEqual({ foo: 'bar' });
  });

  it('parses multiple cookies', () => {
    expect(parseCookieHeader('a=1; b=2; c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('returns empty object for null/undefined', () => {
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it('skips malformed entries', () => {
    expect(parseCookieHeader('valid=1; broken; another=2')).toEqual({ valid: '1', another: '2' });
  });

  it('handles values containing equals signs (cookie format includes them)', () => {
    expect(parseCookieHeader('payload=abc.def==')).toEqual({ payload: 'abc.def==' });
  });
});
