import type { Experiment, Resolution, StoredAssignment } from '@cuped-io/flame';

/**
 * Subset of the response shape that the cuped API's `/{api_key}/experiments/active`
 * returns. We parse only what we need for prehydration.
 */
interface ActiveExperimentsResponse {
  experiments: Experiment[];
}

/**
 * Subset of the response shape that the cuped API's `/{api_key}/evaluate`
 * returns: one answer per running experiment and promoted winner.
 */
interface EvaluateResponse {
  evaluations: Array<{
    experiment_id: string;
    /** `null` when the caller is in no variant (see `resolution`). */
    variant_id: string | null;
    resolution: Resolution;
  }>;
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
 * Every experiment's arm for the user, from one `/evaluate` call (ember ADR
 * 0041). Writes no assignment: the page that delivers an arm records it
 * (flame#47). Holdout admission still happens here. Throws if the call fails
 * or the body has no evaluations list. An experiment ember left out of the
 * answer is missing from the map.
 */
export async function evaluateArms(
  opts: FetchOpts & { userId: string }
): Promise<Map<string, ArmOutcome>> {
  const res = await fetch(`${opts.apiUrl}/${opts.apiKey}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ user_id: opts.userId }),
    signal: opts.signal,
  });
  if (!res.ok) {
    throw new Error(`evaluate failed: ${res.status}`);
  }
  const body = (await res.json()) as EvaluateResponse;
  if (!Array.isArray(body?.evaluations)) {
    throw new Error('no evaluations in the evaluate response');
  }
  const assignedAt = new Date().toISOString();
  return new Map(
    body.evaluations.map((answer): [string, ArmOutcome] => {
      if (answer.resolution === 'held_out') return [answer.experiment_id, { kind: 'held_out' }];
      // A resolution this version doesn't know is treated as one that may lift.
      if (
        (answer.resolution !== 'assigned' && answer.resolution !== 'promoted_winner') ||
        answer.variant_id === null
      ) {
        return [answer.experiment_id, { kind: 'declined' }];
      }
      return [
        answer.experiment_id,
        {
          kind: 'assigned',
          assignment: {
            experimentId: answer.experiment_id,
            variantId: answer.variant_id,
            userId: opts.userId,
            assignedAt,
          },
        },
      ];
    })
  );
}

/**
 * One experiment's `/evaluate` outcome.
 *
 * - `assigned`: the user is in a variant.
 * - `held_out`: the user is in the project's Holdout. Lasting — never
 *   worth asking again.
 * - `declined`: the workspace is at its event cap or archived. Renders
 *   the original like `held_out`, but lifts on upgrade, billing reset or
 *   revive, so it is worth asking again later.
 */
export type ArmOutcome =
  | { kind: 'assigned'; assignment: StoredAssignment }
  | { kind: 'held_out' }
  | { kind: 'declined' };
