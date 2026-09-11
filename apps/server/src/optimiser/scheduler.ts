import { GreedyScheduler, LpScheduler, ResilientScheduler } from '@cleangrid/engine';
import type { Scheduler } from '@cleangrid/shared';
import type { AppConfig } from '../config';
import type { Logger } from '../logger';

/**
 * Chooses the scheduling engine. The LP is the real one; it is wrapped so that a solver failure
 * degrades to the greedy plan instead of leaving chargers without instructions.
 */
export function createScheduler(config: AppConfig, logger: Logger): Scheduler {
  if (config.SCHEDULER === 'greedy') return new GreedyScheduler();
  return new ResilientScheduler(new LpScheduler(), {
    onFallback: (reason) => logger.error({ reason }, 'LP solver failed, using the greedy plan'),
  });
}
