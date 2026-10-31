/**
 * Parse a flame DSN of the form
 * `https://<apiKey>@<host>` into its constituent parts. Mirrors
 * `parseDsn` in `@cuped-io/flame/dsn.ts`, kept local to avoid pulling
 * the whole flame bundle into edge runtimes.
 */
export function parseDsn(dsn: string): { apiKey: string; apiUrl: string } {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error(`Invalid DSN: ${dsn}`);
  }
  const apiKey = url.username;
  if (!apiKey) throw new Error('Invalid DSN: missing api key');
  const apiUrl = `${url.protocol}//${url.host}`;
  return { apiKey, apiUrl };
}
