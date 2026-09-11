import {
  kwToW,
  slotStartMs,
  type Charger,
  type ChargingPeriod,
  type ChargingSession,
  type Clock,
  type DispatchRecord,
  type DispatchStatus,
  type PlanRecord,
  type SlotGrid,
} from '@cleangrid/shared';
import type { ChargingProfile } from '@cleangrid/ocpp';
import { randomUUID } from 'node:crypto';
import type { EventBus } from '../events';
import type { Logger } from '../logger';
import { SAFETY_PROFILE_ID, type OcppGateway } from '../ocpp/gateway';
import type { Repositories } from '../repo/types';
import type { SessionService } from '../sessions/service';

/** Turns a plan into OCPP SetChargingProfile messages: the step where a plan becomes hardware behaviour. */

export interface DispatchIntent {
  readonly sessionId: string;
  readonly chargerId: string;
  readonly connectorId: number;
  readonly transactionId: number;
  /** Limit in force right now, watts. */
  readonly limitW: number;
  readonly periods: readonly ChargingPeriod[];
}

export interface BuildDispatchInput {
  readonly grid: SlotGrid;
  readonly allocationsKw: Readonly<Record<string, readonly number[]>>;
  readonly sessions: readonly ChargingSession[];
  readonly minPowerKw: (chargerId: string) => number;
  readonly maxPowerKw: (chargerId: string) => number;
  readonly lookaheadPeriods: number;
  readonly lastSentW: ReadonlyMap<string, readonly number[]>;
  readonly hysteresisW: number;
  /** When the last profile was sent, so one can be refreshed before it expires. */
  readonly lastSentAtMs?: ReadonlyMap<string, number>;
  readonly staleAfterMs?: number;
}

export interface DispatchDecision {
  readonly send: readonly DispatchIntent[];
  readonly unchanged: readonly string[];
}

/** Collapse repeated limits: a charger only needs a period where the limit changes. */
function collapse(limitsW: readonly number[], slotSeconds: number): ChargingPeriod[] {
  const periods: ChargingPeriod[] = [];
  limitsW.forEach((limitW, index) => {
    if (index === 0 || limitW !== limitsW[index - 1]) {
      periods.push({ startPeriodS: index * slotSeconds, limitW });
    }
  });
  return periods;
}

export function buildDispatch(input: BuildDispatchInput): DispatchDecision {
  const slotSeconds = input.grid.slotMinutes * 60;
  const send: DispatchIntent[] = [];
  const unchanged: string[] = [];

  for (const session of input.sessions) {
    if (session.status !== 'active' || session.transactionId === null) continue;
    const row = input.allocationsKw[session.id] ?? [];
    const minW = kwToW(input.minPowerKw(session.chargerId));
    const maxW = kwToW(Math.min(input.maxPowerKw(session.chargerId), session.maxPowerKw));

    const limitsW = Array.from({ length: input.lookaheadPeriods }, (_, index) => {
      const requestedW = Math.round(kwToW(row[index] ?? 0));
      // A charger cannot hold a trickle below its minimum current, so ask for nothing instead.
      if (requestedW < minW) return 0;
      return Math.min(requestedW, Math.round(maxW));
    });

    const previous = input.lastSentW.get(session.id);
    // A profile carries a duration. If nothing changes for long enough it would expire and the
    // charger would fall back to its default, so refresh it before that happens.
    const sentAtMs = input.lastSentAtMs?.get(session.id);
    const stale =
      input.staleAfterMs !== undefined && sentAtMs !== undefined && input.grid.nowMs - sentAtMs >= input.staleAfterMs;
    const changed =
      stale ||
      previous === undefined ||
      previous.length !== limitsW.length ||
      limitsW.some((limitW, index) => Math.abs(limitW - (previous[index] ?? 0)) >= input.hysteresisW);

    if (!changed) {
      unchanged.push(session.id);
      continue;
    }
    send.push({
      sessionId: session.id,
      chargerId: session.chargerId,
      connectorId: session.connectorId,
      transactionId: session.transactionId,
      limitW: limitsW[0] ?? 0,
      periods: collapse(limitsW, slotSeconds),
    });
  }
  return { send, unchanged };
}

export function buildChargingProfile(
  intent: DispatchIntent,
  grid: SlotGrid,
  profileId: number,
  lookaheadPeriods: number,
): ChargingProfile {
  return {
    chargingProfileId: profileId,
    transactionId: intent.transactionId,
    stackLevel: 1,
    chargingProfilePurpose: 'TxProfile',
    chargingProfileKind: 'Absolute',
    chargingSchedule: {
      startSchedule: new Date(slotStartMs(grid, 0)).toISOString(),
      duration: lookaheadPeriods * grid.slotMinutes * 60,
      chargingRateUnit: 'W',
      chargingSchedulePeriod: intent.periods.map((period) => ({ startPeriod: period.startPeriodS, limit: period.limitW })),
    },
  };
}

export interface DispatchServiceDeps {
  readonly gateway: OcppGateway;
  readonly repos: Repositories;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly sessions: SessionService;
  readonly lookaheadPeriods: number;
  readonly hysteresisW: number;
}

/** Sends profiles, records what happened, and gives up on a charger that will not obey. */
export class DispatchService {
  private readonly lastSentW = new Map<string, readonly number[]>();
  private readonly lastSentAtMs = new Map<string, number>();
  private readonly profileIds = new Map<string, number>();
  private readonly rejections = new Map<string, number>();
  private readonly lastDefaultW = new Map<string, number>();
  private nextProfileId = 1;

  constructor(private readonly deps: DispatchServiceDeps) {
    // A finished session will never be dispatched again; drop what was remembered about it.
    this.deps.bus.on('session.ended', ({ session }) => this.forget(session.id));
  }

  forget(sessionId: string): void {
    this.lastSentW.delete(sessionId);
    this.lastSentAtMs.delete(sessionId);
    this.profileIds.delete(sessionId);
    this.rejections.delete(sessionId);
  }

  async apply(plan: PlanRecord, grid: SlotGrid, sessions: readonly ChargingSession[]): Promise<number> {
    const chargers = new Map(
      (await this.deps.repos.chargers.listBySite(plan.siteId)).map((charger) => [charger.id, charger]),
    );
    const decision = buildDispatch({
      grid,
      allocationsKw: plan.allocationsKw,
      sessions,
      minPowerKw: (id) => chargers.get(id)?.minPowerKw ?? 0,
      maxPowerKw: (id) => chargers.get(id)?.maxPowerKw ?? Number.POSITIVE_INFINITY,
      lookaheadPeriods: this.deps.lookaheadPeriods,
      lastSentW: this.lastSentW,
      hysteresisW: this.deps.hysteresisW,
      lastSentAtMs: this.lastSentAtMs,
      staleAfterMs: Math.max(1, this.deps.lookaheadPeriods - 1) * grid.slotMinutes * 60_000,
    });

    let sent = 0;
    for (const intent of decision.send) {
      const ok = await this.send(plan, grid, intent);
      if (ok) sent += 1;
    }
    await this.reserveForIdleBays(plan, sessions, [...chargers.values()]);
    return sent;
  }

  /**
   * Keep the headroom a car could take if it plugs in between solves inside what the connection
   * can carry. Idle bays share whatever the plan leaves spare; if the plan uses everything, an
   * arriving car waits the few seconds until the next solve rather than pushing the site over.
   */
  private async reserveForIdleBays(
    plan: PlanRecord,
    sessions: readonly ChargingSession[],
    chargers: readonly Charger[],
  ): Promise<void> {
    const busy = new Set(sessions.filter((session) => session.status === 'active').map((session) => session.chargerId));
    const idle = chargers.filter((charger) => charger.online && !busy.has(charger.id));
    if (idle.length === 0) return;

    const capKw = plan.capKw[0] ?? Number.POSITIVE_INFINITY;
    const spareKw = Math.max(0, capKw - (plan.siteLoadKw[0] ?? 0));
    const shareKw = spareKw / idle.length;

    for (const charger of idle) {
      const allowedKw = Math.min(charger.maxPowerKw, shareKw);
      // A charger cannot hold a trickle below its minimum current, so round that down to nothing.
      const limitW = Math.round((allowedKw < charger.minPowerKw ? 0 : allowedKw) * 1000);
      const previous = this.lastDefaultW.get(charger.id);
      if (previous !== undefined && Math.abs(limitW - previous) < this.deps.hysteresisW) continue;
      try {
        await this.deps.gateway.setChargingProfile(charger.id, {
          connectorId: 0,
          csChargingProfiles: {
            chargingProfileId: SAFETY_PROFILE_ID,
            stackLevel: 0,
            chargingProfilePurpose: 'TxDefaultProfile',
            chargingProfileKind: 'Relative',
            chargingSchedule: { chargingRateUnit: 'W', chargingSchedulePeriod: [{ startPeriod: 0, limit: limitW }] },
          },
        });
        this.lastDefaultW.set(charger.id, limitW);
      } catch (error) {
        this.deps.logger.debug({ err: error, chargerId: charger.id }, 'could not update the idle-bay reserve');
      }
    }
  }

  private async send(plan: PlanRecord, grid: SlotGrid, intent: DispatchIntent): Promise<boolean> {
    const profileId = this.profileIdFor(intent.sessionId);
    const profile = buildChargingProfile(intent, grid, profileId, this.deps.lookaheadPeriods);
    let status: DispatchStatus = 'Error';
    let error: string | null = null;

    try {
      const response = await this.deps.gateway.setChargingProfile(intent.chargerId, {
        connectorId: intent.connectorId,
        csChargingProfiles: profile,
      });
      status = response.status as DispatchStatus;
    } catch (caught) {
      error = (caught as Error).message;
      status = this.deps.gateway.isOnline(intent.chargerId) ? 'Timeout' : 'Offline';
    }

    if (status === 'Accepted') {
      this.rejections.delete(intent.sessionId);
      this.lastSentW.set(intent.sessionId, intent.periods.map((period) => period.limitW));
      this.lastSentAtMs.set(intent.sessionId, this.deps.clock.now());
      await this.deps.sessions.setLimit(intent.sessionId, intent.limitW / 1000);
    } else {
      await this.handleRefusal(intent, status, error);
    }

    const record = {
      id: randomUUID(),
      planId: plan.id,
      siteId: plan.siteId,
      chargerId: intent.chargerId,
      connectorId: intent.connectorId,
      sessionId: intent.sessionId,
      sentMs: this.deps.clock.now(),
      limitW: intent.limitW,
      periods: intent.periods,
      status,
      error,
    } satisfies DispatchRecord;
    await this.deps.repos.dispatches.append(record);
    this.deps.bus.emit('dispatch.sent', { dispatch: record });
    return status === 'Accepted';
  }

  /**
   * One refusal is retried on the next solve. A charger that keeps refusing is marked
   * uncontrolled: it runs at full power and the optimiser plans around it as fixed load,
   * so the other cars still meet their deadlines.
   */
  private async handleRefusal(intent: DispatchIntent, status: DispatchStatus, error: string | null): Promise<void> {
    const count = (this.rejections.get(intent.sessionId) ?? 0) + 1;
    this.rejections.set(intent.sessionId, count);
    this.lastSentW.delete(intent.sessionId);
    this.deps.logger.warn(
      { chargerId: intent.chargerId, sessionId: intent.sessionId, status, err: error, attempt: count },
      'charging profile not accepted',
    );
    if (count >= 2 && (status === 'Rejected' || status === 'NotSupported')) {
      await this.deps.repos.chargers.update(intent.chargerId, { uncontrolled: true });
      this.deps.logger.error(
        { chargerId: intent.chargerId },
        'charger refuses charging profiles; planning around it at full power',
      );
    }
  }

  private profileIdFor(sessionId: string): number {
    const existing = this.profileIds.get(sessionId);
    if (existing !== undefined) return existing;
    const id = this.nextProfileId;
    this.nextProfileId += 1;
    this.profileIds.set(sessionId, id);
    return id;
  }
}
