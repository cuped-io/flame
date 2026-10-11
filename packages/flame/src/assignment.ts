import type {
  StoredAssignment,
  Experiment,
  IdentityMetadata,
  PromotedExperiment,
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

/**
 * Get existing assignment for an experiment, or request a new one
 *
 * @param experiment - The experiment to get/create assignment for
 * @param userId - User identifier
 * @param apiClient - API client instance
 * @param context - Optional user context for segment-level CUPED
 * @param identity - Optional identity metadata for CUPED eligibility
 * @returns The assignment, or `null` when the user is in no variant (held
 *   out, workspace capped or archived). `null` means "render the original":
 *   it is a normal outcome, not an error, and is never persisted.
 */
export async function getOrCreateAssignment(
  experiment: Experiment,
  userId: string,
  apiClient: ApiClient,
  context?: UserContext,
  identity?: IdentityMetadata
): Promise<StoredAssignment | null> {
  // Check for existing assignment
  const stored = getStoredAssignments();
  const existing = stored[experiment.id];

  if (existing) {
    // Verify the variant still exists in the experiment
    const variantExists = experiment.variants?.some((v) => v.id === existing.variantId);
    if (variantExists) {
      return existing;
    }
    // Variant no longer exists, need new assignment
  }

  // Request new assignment from API with context and identity
  const response = await apiClient.assignVariant(experiment.id, userId, context, identity);

  // In no variant: held out, capped or archived. Don't persist, so the next
  // page load asks again and picks up an enrollment once one is possible.
  if (
    response.held_out ||
    response.cap_reached ||
    response.workspace_archived ||
    response.variant_id === null
  ) {
    return null;
  }

  // Convert API response to stored format
  const assignment: StoredAssignment = {
    experimentId: response.experiment_id,
    variantId: response.variant_id,
    userId: userId,
    // `null` for a promoted winner, which writes no assignment row.
    assignedAt: response.assigned_at ?? new Date().toISOString(),
  };

  // Store for future visits
  storeAssignment(assignment);

  return assignment;
}

/**
 * Ask `/assign` whether this user sees a promoted experiment's winner.
 *
 * Always asks, never reads or writes the stored assignment: the Holdout gate
 * runs before ember's promotion short-circuit, so only ember knows whether
 * this user is held out, and a stored row may name a losing variant. Leaving
 * that row alone means a reverted promotion puts the user back in it.
 *
 * @returns The winner, or `null` to render the original (held out, any
 *   other answer, or the request failed).
 */
export async function resolvePromotedWinner(
  promoted: PromotedExperiment,
  userId: string,
  apiClient: ApiClient,
  context?: UserContext,
  identity?: IdentityMetadata
): Promise<Variant | null> {
  try {
    const response = await apiClient.assignVariant(promoted.id, userId, context, identity);
    if (response.held_out || response.variant_id !== promoted.winner.id) return null;
    return promoted.winner;
  } catch {
    // The original is always a safe answer; don't fail init over it.
    return null;
  }
}

/**
 * Get the assigned variant for an experiment
 */
export function getAssignedVariant(experiment: Experiment, assignment: StoredAssignment) {
  return experiment.variants?.find((v) => v.id === assignment.variantId);
}

/** Delete the stored assignments cache. Consent withdrawal (flame#18). */
export function clearStoredAssignments(): void {
  try {
    localStorage.removeItem(ASSIGNMENTS_KEY);
  } catch {
    // No storage: nothing was persisted.
  }
}
