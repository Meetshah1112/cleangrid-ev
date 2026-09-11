export { ScheduleValidationError, VALIDATION_CODES, type ScheduleValidationCode } from './errors';
export { validateProblem } from './validate';
export {
  SHORTFALL_PENALTY,
  SHORTFALL_TOLERANCE_KWH,
  buildObjectiveContext,
  chargingHeadroomKw,
  evaluatePlan,
  normalise,
  slotScore,
  type ObjectiveContext,
  type PlanEvaluation,
} from './objective';
export { buildResult, cleanKw } from './result';
export { GreedyScheduler, orderByLaxity, solveGreedy, type GreedyOptions } from './greedy';
export { checkDeadline, maxDeliverableKwh, type DeadlineCheck, type DeadlineCheckInput } from './feasibility';
