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
  assignment_id: string | null;
  experiment_id: string;
  /** `null` when the caller is in no variant (see the flags below). */
  variant_id: string | null;
  variant_name: string | null;
  is_control: boolean | null;
  assigned_at: string | null;
  held_out?: boolean;
  cap_reached?: boolean;
  workspace_archived?: boolean;
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

/**
 * Outcome of an `/assign` call.
 *
 * - `assigned`: the user is in a variant.
 * - `held_out`: the user is in the project's Holdout. Lasting — never
 *   worth asking again.
 * - `declined`: the workspace is at its event cap or archived. Renders
 *   the original like `held_out`, but lifts on upgrade, billing reset or
 *   revive, so it is worth asking again later.
 */
export type AssignOutcome =
  | { kind: 'assigned'; assignment: StoredAssignment }
  | { kind: 'held_out' }
  | { kind: 'declined' };

/**
 * Assign the user to a variant. A no-variant answer is an answer, not a
 * failure: it resolves to `held_out` or `declined`, never throws. Its no-variant
 * answers match `resolveAssignments` in `@cuped-io/flame`, which now asks
 * `/evaluate` and records an arm only when it delivers it (flame#46). This
 * still enrols at `/assign`; moving the edge to record on delivery is
 * flame#47.
 */
export async function assignVariant(
  opts: FetchOpts & { experimentId: string; userId: string }
): Promise<AssignOutcome> {
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
  if (body.held_out) return { kind: 'held_out' };
  // A null variant with no flag set is an arm this version doesn't know;
  // treat it as one that may lift.
  if (body.cap_reached || body.workspace_archived || body.variant_id === null) {
    return { kind: 'declined' };
  }
  return {
    kind: 'assigned',
    assignment: {
      experimentId: body.experiment_id,
      variantId: body.variant_id,
      userId: opts.userId,
      // `null` for a promoted winner, which writes no assignment row.
      assignedAt: body.assigned_at ?? new Date().toISOString(),
    },
  };
}
