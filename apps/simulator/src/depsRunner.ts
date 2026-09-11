/** Shared-package imports used by the runner and CLI. */
export {
  MS_PER_MINUTE,
  SimClock,
  formatLocalTime,
  localDateOf,
  parseScenario,
  rebaseScenario,
  resolveArrivals,
  scenarioStartMs,
} from '@cleangrid/shared';
export type { Clock, ResolvedArrival, Scenario } from '@cleangrid/shared';
