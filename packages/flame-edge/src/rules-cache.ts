import { parseRules, type RulesFile } from '@cuped-io/flame/rules';

/**
 * How long a rules copy is used before a request starts a refresh. ember
 * caches the file at its edge for about a minute, so sooner gains nothing.
 */
const RULES_REFRESH_MS = 60_000;

/**
 * Longest a refresh may take. A hung fetch would otherwise block every later
 * refresh of the project.
 */
const RULES_FETCH_TIMEOUT_MS = 10_000;

interface Entry {
  rules: RulesFile | null;
  /** When the last refresh started, ms since epoch. */
  refreshedAt: number;
  refreshing: boolean;
}

/** One copy per project in this runtime, so two projects never mix. */
const copies = new Map<string, Entry>();

/**
 * The project's rules file as last fetched, or `null` when this runtime has
 * none yet. Never waits: a missing or old copy starts a refresh in the
 * background, which the caller hands to `waitUntil` so the runtime lets it
 * finish after the response.
 */
export function cachedRules(opts: {
  apiUrl: string;
  apiKey: string;
  nowMs: number;
  waitUntil?: (promise: Promise<unknown>) => void;
}): RulesFile | null {
  const key = `${opts.apiUrl}/${opts.apiKey}`;
  let entry = copies.get(key);
  if (!entry) {
    entry = { rules: null, refreshedAt: -Infinity, refreshing: false };
    copies.set(key, entry);
  }
  if (!entry.refreshing && opts.nowMs - entry.refreshedAt >= RULES_REFRESH_MS) {
    // A failed refresh keeps the old copy and waits a full period too, so an
    // unreachable ember costs one fetch a minute, not one per request.
    entry.refreshing = true;
    entry.refreshedAt = opts.nowMs;
    const done = fetchRules(opts.apiUrl, opts.apiKey)
      .then((rules) => {
        if (rules) entry.rules = rules;
      })
      .catch(() => {})
      .finally(() => {
        entry.refreshing = false;
      });
    opts.waitUntil?.(done);
  }
  return entry.rules;
}

/** GET /{api_key}/rules (ember#309). `null` for a file flame cannot read. */
async function fetchRules(apiUrl: string, apiKey: string): Promise<RulesFile | null> {
  const res = await fetch(`${apiUrl}/${apiKey}/rules`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(RULES_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`rules fetch failed: ${res.status}`);
  return parseRules(await res.json());
}
