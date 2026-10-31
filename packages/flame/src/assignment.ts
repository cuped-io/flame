import type { StoredAssignment } from './types';

// Re-export identity functions for backwards compatibility
export { getUserId, getIdentity, identify, clearIdentity } from './identity';

const ASSIGNMENTS_KEY = 'flame_assignments';

/** The arms saved for this browser, by experiment id: recorded ones only (flame#46). */
export function savedArms(): Record<string, StoredAssignment> {
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
    const assignments = savedArms();
    assignments[assignment.experimentId] = assignment;
    localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  } catch {
    // localStorage not available, assignment will only last for this session
  }
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
