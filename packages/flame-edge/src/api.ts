import type { Experiment, StoredAssignment } from '@cuped-io/flame';

/**
 * Subset of the response shape that the cuped API's `/{api_key}/experiments/active`
 * returns. We parse only what we need for prehydration.
 */
interface ActiveExperimentsResponse {
  experiments: Experiment[];
}

/**
 * Subset of the response shape that the cuped API's
 * `/{api_key}/experiments/{id}/assign` returns.
 */
interface AssignResponse {
  assignment_id: string;
  experiment_id: string;
  variant_id: string;
  variant_name: string;
  is_control: boolean;
  assigned_at: string;
}

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

interface FetchOpts {
  apiUrl: string;
  apiKey: string;
  signal?: AbortSignal;
}

export async function fetchActiveExperiments(opts: FetchOpts): Promise<Experiment[]> {
  const res = await fetch(`${opts.apiUrl}/${opts.apiKey}/experiments/active`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`active experiments fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as ActiveExperimentsResponse;
  return body.experiments ?? [];
}

export async function assignVariant(
  opts: FetchOpts & { experimentId: string; userId: string }
): Promise<StoredAssignment> {
  const res = await fetch(`${opts.apiUrl}/${opts.apiKey}/experiments/${opts.experimentId}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ user_id: opts.userId }),
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`assign failed for ${opts.experimentId}: ${res.status}`);
  }
  const body = (await res.json()) as AssignResponse;
  return {
    experimentId: body.experiment_id,
    variantId: body.variant_id,
    userId: opts.userId,
    assignedAt: body.assigned_at,
  };
}
