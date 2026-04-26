/**
 * Parsed DSN components
 */
export interface ParsedDsn {
  /** API key extracted from the DSN (username portion) */
  apiKey: string;
  /** API URL (protocol + host) */
  apiUrl: string;
}

/**
 * Parse a DSN string into its components
 *
 * DSN format: https://{api_key}@{host}
 * API key must be 32 hex characters (e.g., https://a1b2c3d4e5f6789012345678abcdef01@api.cuped.io)
 *
 * @param dsn - The DSN string to parse
 * @returns Parsed DSN components
 * @throws Error if DSN is invalid
 */
export function parseDsn(dsn: string): ParsedDsn {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error(`Invalid DSN: not a valid URL - ${dsn}`);
  }

  if (!url.username) {
    throw new Error('DSN must include API key before @ (e.g., https://abc123...@api.cuped.io)');
  }

  if (!/^[0-9a-f]{32}$/i.test(url.username)) {
    throw new Error('Invalid DSN API key: must be 32 hex characters');
  }

  return {
    apiKey: url.username,
    apiUrl: `${url.protocol}//${url.host}`,
  };
}
