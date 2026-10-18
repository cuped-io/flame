/**
 * Test support (flame#46): the `/evaluate` answer that matches an `/assign`
 * answer, so a test written against `/assign` can serve the same arm from
 * `/evaluate`. Not part of the bundle: only test files import it.
 */
import type { AssignmentResponse, EvaluateResponse, ExperimentEvaluation } from './types';

export function evaluationFrom(assign: AssignmentResponse): ExperimentEvaluation {
  return {
    experiment_id: assign.experiment_id,
    variant_id: assign.variant_id,
    variant_name: assign.variant_name,
    is_control: assign.is_control,
    resolution: assign.resolution,
  };
}

/** An `/evaluate` response body built from `/assign` answers. */
export function evaluateBody(...assigns: AssignmentResponse[]): string {
  const body: EvaluateResponse = { evaluations: assigns.map(evaluationFrom) };
  return JSON.stringify(body);
}
