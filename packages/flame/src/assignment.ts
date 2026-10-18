import type {
  StoredAssignment,
  Experiment,
  IdentityMetadata,
  PromotedExperiment,
  ExperimentEvaluation,
  Variant,
} from './types';
import type { UserContext } from './context';
import type { ApiClient } from './api';

// Re-export identity functions for backwards compatibility
export { getUserId, getIdentity, identify, clearIdentity } from './identity';

const ASSIGNMENTS_KEY = 'flame_assignments';

/**
 * Get stored assignments from localStorage
 */
function getStoredAssignments(): Record<string, StoredAssignment> {
  try {
    const stored = localStorage.getItem(ASSIGNMENTS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Store an assignment in localStorage
 */
function storeAssignment(assignment: StoredAssignment): void {
  try {
    const assignments = getStoredAssignments();
    assignments[assignment.experimentId] = assignment;
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch {
    // localStorage not available, assignment will only last for this session
  }
}

/** Every arm this visitor gets, and the promoted winners they see. */
export interface ResolvedAssignments {
  /** Experiment id to arm. An experiment left out renders the original. */
  arms: Map<string, StoredAssignment>;
  winners: Variant[];
}

/**
 * The arm for every experiment, from the cache or one `POST /evaluate`
 * (flame#46). Evaluation enrols nobody, so an arm here is not yet counted:
 * flame records it when it delivers it. Only a recorded arm is cached, so an
 * arm never delivered is evaluated again, against ember's checks of the day.
 *
 * A cached arm whose variant still exists is kept, as before. `/evaluate` is
 * asked when any experiment has no cached arm, or when there are promoted
 * winners, because only ember knows whether this user is held out of them.
 * Held out, capped and archived answers are not cached, so the next page load
 * asks again. If `/evaluate` fails, cached arms still apply and everything
 * else renders the original.
 */
export async function resolveAssignments(
  experiments: Experiment[],
  promoted: PromotedExperiment[],
  userId: string,
  apiClient: ApiClient,
  context?: UserContext,
  identity?: IdentityMetadata
): Promise<ResolvedAssignments> {
  const stored = getStoredAssignments();
  const arms = new Map<string, StoredAssignment>();
  const uncached: Experiment[] = [];
  for (const experiment of experiments) {
    const existing = stored[experiment.id];
    if (existing && experiment.variants?.some((v) => v.id === existing.variantId)) {
      arms.set(experiment.id, existing);
    } else {
      uncached.push(experiment);
    }
  }
  if (uncached.length === 0 && promoted.length === 0) return { arms, winners: [] };

  let evaluations: ExperimentEvaluation[];
  try {
    const response = await apiClient.evaluate(userId, context, identity);
    // A body without the list (an error page, an older server) is no answer,
    // not a crash: init must still track and reveal.
    if (!Array.isArray(response?.evaluations)) throw new Error('no evaluations in the response');
    evaluations = response.evaluations;
  } catch (error) {
    console.warn('[Flame] Evaluation failed; rendering the original:', error);
    return { arms, winners: [] };
  }
  const answers = new Map(evaluations.map((e) => [e.experiment_id, e]));

  for (const experiment of uncached) {
    const answer = answers.get(experiment.id);
    if (
      !answer?.variant_id ||
      (answer.resolution !== 'assigned' && answer.resolution !== 'promoted_winner')
    ) {
      continue;
    }
    if (!experiment.variants?.some((v) => v.id === answer.variant_id)) continue;
    const assignment: StoredAssignment = {
      experimentId: experiment.id,
      variantId: answer.variant_id,
      userId,
      assignedAt: new Date().toISOString(),
    };
    arms.set(experiment.id, assignment);
  }

  const winners = promoted.flatMap((p) => {
    const answer = answers.get(p.id);
    return answer?.resolution === 'promoted_winner' && answer.variant_id === p.winner.id
      ? [p.winner]
      : [];
  });
  return { arms, winners };
}

/**
 * Get the assigned variant for an experiment
 */
export function getAssignedVariant(experiment: Experiment, assignment: StoredAssignment) {
  return experiment.variants?.find((v) => v.id === assignment.variantId);
}

// Which arm was recorded for whom, per experiment (flame#46). ember ignores a
// duplicate record, but without this every page load would send one.
const RECORDED_KEY = 'flame_recorded';

function getRecorded(): Record<string, string> {
  try {
    const stored = localStorage.getItem(RECORDED_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Which arms were already recorded, read once per delivery. It answers
 * whether this user's arm for the experiment was recorded: a different user
 * or a different arm is recorded again.
 */
export function recordedArms(): (
  experimentId: string,
  userId: string,
  variantId: string
) => boolean {
  const recorded = getRecorded();
  return (experimentId, userId, variantId) => recorded[experimentId] === `${userId}:${variantId}`;
}

/** Remember that this user's arm was recorded, and cache it for later loads. */
export function markRecorded(assignment: StoredAssignment): void {
  storeAssignment(assignment);
  try {
    const recorded = getRecorded();
    recorded[assignment.experimentId] = `${assignment.userId}:${assignment.variantId}`;
    localStorage.setItem(RECORDED_KEY, JSON.stringify(recorded));
  } catch {
    // No storage: this page load records again next time; ember dedupes.
  }
}

/** Delete the stored assignments cache. Consent withdrawal (flame#18). */
export function clearStoredAssignments(): void {
  try {
    localStorage.removeItem(ASSIGNMENTS_KEY);
    localStorage.removeItem(RECORDED_KEY);
  } catch {
    // No storage: nothing was persisted.
  }
}
