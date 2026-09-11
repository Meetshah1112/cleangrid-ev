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
export {
  DEFAULT_TIME_LIMIT_SECONDS,
  LpScheduler,
  ResilientScheduler,
  buildLpModel,
  resetHighs,
  solveLp,
  type LpModel,
  type LpOptions,
  type ResilientSchedulerOptions,
} from './lp';
export { checkDeadline, maxDeliverableKwh, type DeadlineCheck, type DeadlineCheckInput } from './feasibility';
export {
  MeterDataError,
  baselineIntervals,
  buildSessionReport,
  greenScore,
  intervalsFromReadings,
  summarise,
  totalKwh,
  weightedSum,
  type BaselineInput,
  type BuildReportInput,
  type EnergyFacts,
  type EnergyInterval,
  type GreenScore,
  type GreenScoreInput,
  type SignalSeries,
} from './emissions';
