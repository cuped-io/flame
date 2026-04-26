import type { StoredAssignment, Experiment, IdentityMetadata } from './types';
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
 */
export async function getOrCreateAssignment(
  experiment: Experiment,
  userId: string,
  apiClient: ApiClient,
  context?: UserContext,
  identity?: IdentityMetadata
): Promise<StoredAssignment> {
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

  // Convert API response to stored format
  const assignment: StoredAssignment = {
    experimentId: response.experiment_id,
    variantId: response.variant_id,
    userId: userId,
    assignedAt: response.assigned_at,
  };

  // Store for future visits
  storeAssignment(assignment);

  return assignment;
}

/**
 * Get the assigned variant for an experiment
 */
export function getAssignedVariant(experiment: Experiment, assignment: StoredAssignment) {
  return experiment.variants?.find((v) => v.id === assignment.variantId);
}
