import { describe, expect, it } from 'vitest';
import { parseDsn } from './dsn';

describe('parseDsn', () => {
  it('parses a valid DSN with 32-char hex key', () => {
    const dsn = 'https://a1b2c3d4e5f6789012345678abcdef01@api.cuped.io';
    const result = parseDsn(dsn);

    expect(result.apiKey).toBe('a1b2c3d4e5f6789012345678abcdef01');
    expect(result.apiUrl).toBe('https://api.cuped.io');
  });

  it('parses a valid DSN with uppercase hex key', () => {
    const dsn = 'https://A1B2C3D4E5F6789012345678ABCDEF01@api.cuped.io';
    const result = parseDsn(dsn);

    expect(result.apiKey).toBe('A1B2C3D4E5F6789012345678ABCDEF01');
    expect(result.apiUrl).toBe('https://api.cuped.io');
  });

  it('parses a DSN with a custom port', () => {
    const dsn = 'https://a1b2c3d4e5f6789012345678abcdef01@localhost:3000';
    const result = parseDsn(dsn);

    expect(result.apiKey).toBe('a1b2c3d4e5f6789012345678abcdef01');
    expect(result.apiUrl).toBe('https://localhost:3000');
  });

  it('parses a DSN with HTTP protocol (for local dev)', () => {
    const dsn = 'http://a1b2c3d4e5f6789012345678abcdef01@localhost:3000';
    const result = parseDsn(dsn);

    expect(result.apiKey).toBe('a1b2c3d4e5f6789012345678abcdef01');
    expect(result.apiUrl).toBe('http://localhost:3000');
  });

  it('throws error for DSN without API key', () => {
    const dsn = 'https://api.cuped.io';

    expect(() => parseDsn(dsn)).toThrow('DSN must include API key before @');
  });

  it('throws error for invalid API key format', () => {
    const dsn = 'https://invalid_key@api.cuped.io';

    expect(() => parseDsn(dsn)).toThrow('Invalid DSN API key: must be 32 hex characters');
  });

  it('throws error for hex key with wrong length', () => {
    const dsn = 'https://a1b2c3d4e5f67890@api.cuped.io'; // 16 chars, not 32

    expect(() => parseDsn(dsn)).toThrow('Invalid DSN API key: must be 32 hex characters');
  });

  it('throws error for invalid URL', () => {
    const dsn = 'not-a-valid-url';

    expect(() => parseDsn(dsn)).toThrow('Invalid DSN: not a valid URL');
  });

  it('ignores path in DSN', () => {
    const dsn = 'https://a1b2c3d4e5f6789012345678abcdef01@api.cuped.io/v1/some/path';
    const result = parseDsn(dsn);

    expect(result.apiKey).toBe('a1b2c3d4e5f6789012345678abcdef01');
    expect(result.apiUrl).toBe('https://api.cuped.io');
  });

  it('ignores query string in DSN', () => {
    const dsn = 'https://a1b2c3d4e5f6789012345678abcdef01@api.cuped.io?foo=bar';
    const result = parseDsn(dsn);

    expect(result.apiKey).toBe('a1b2c3d4e5f6789012345678abcdef01');
    expect(result.apiUrl).toBe('https://api.cuped.io');
  });
});
