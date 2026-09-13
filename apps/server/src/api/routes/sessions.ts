import { checkDeadline, solveGreedy } from '@cleangrid/engine';
import {
  CHARGING_MODES,
  MODE_WEIGHTS,
  createSessionSchema,
  createSlotGrid,
  round,
  sessionPreviewSchema,
  slotEndMs,
  updateSessionSchema,
  windowHours,
} from '@cleangrid/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../errors';
import { requireRole, requireSessionAccess } from '../auth';
import { runtimeFor, runtimeForSession, type ApiContext } from '../context';
import { baseLoadForGrid } from '../../optimiser/problem';
import { ok } from '../app';

/** The driver-facing side: declare a need, watch it, change it, stop it. */
export async function registerSessionRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  /**
   * Declare intent. A deadline that cannot physically be met is refused here with the earliest
   * one that can, rather than accepted and quietly missed later.
   */
  app.post('/sessions', async (request, reply) => {
    // A session belongs to the driver who opened it, so only a driver can open one.
    requireRole(request.principal, 'driver');
    const body = createSessionSchema.parse(request.body);
    const driverId = request.principal.id;

    const charger = await ctx.repos.chargers.get(body.chargerId);
    if (!charger) throw new NotFoundError('charger', body.chargerId);
    if (body.connectorId > charger.connectorCount) {
      throw new ValidationError('unknown_connector', `charger ${charger.id} has no connector ${body.connectorId}`);
    }

    // One car, one session: a second would be planned for a car that is not there.
    const open = await ctx.repos.sessions.findOpenByDriver(driverId);
    if (open) {
      throw new ConflictError('session_open', `You already have a session on ${open.chargerId}. Stop it before starting another.`);
    }
    const occupying = await ctx.repos.sessions.findOpenByConnector(charger.id, body.connectorId);
    if (occupying) {
      throw new ConflictError('bay_in_use', `${charger.label} already has a car on it. Choose another bay.`);
    }

    const vehicle = body.vehicleId
      ? await ctx.repos.vehicles.get(body.vehicleId)
      : ((await ctx.repos.vehicles.listByDriver(driverId))[0] ?? null);
    if (body.vehicleId && !vehicle) throw new NotFoundError('vehicle', body.vehicleId);
    if (vehicle && vehicle.driverId !== driverId) {
      throw new AppError('forbidden', 'that vehicle belongs to another driver', 403);
    }

    const maxPowerKw = Math.min(charger.maxPowerKw, vehicle?.maxChargeKw ?? charger.maxPowerKw);
    const deadlineMs = Date.parse(body.deadlineAt);
    const nowMs = ctx.clock.now();
    const check = checkDeadline({ startMs: nowMs, deadlineMs, energyKwh: body.energyKwh, maxPowerKw });
    if (!check.feasible) {
      throw new ValidationError(
        'deadline_unreachable',
        `${body.energyKwh} kWh cannot be delivered by then at ${maxPowerKw} kW`,
        {
          earliestDeadlineAt: new Date(check.earliestFinishMs).toISOString(),
          maxDeliverableKwh: round(check.maxDeliverableKwh, 1),
          maxPowerKw,
        },
      );
    }

    const profile = await ctx.repos.profiles.get(driverId);
    const session = await ctx.sessions.declareIntent({
      siteId: charger.siteId,
      chargerId: charger.id,
      connectorId: body.connectorId,
      driverId,
      vehicleId: vehicle?.id ?? null,
      idTag: profile?.idTag ?? driverId,
      energyKwh: body.energyKwh,
      deadlineMs,
      mode: body.mode,
      source: 'app',
      maxPowerKw,
    });
    // If the charger is online and free, ask it to start. A charger that refuses is not an error:
    // the driver simply plugs the cable in themselves and the session is waiting for them.
    let remoteStart: string | null = null;
    if (charger.online) {
      const connector = await ctx.repos.connectors.get(charger.id, body.connectorId);
      if (!connector?.sessionId) {
        remoteStart = await ctx.gateway
          .remoteStart(charger.id, { connectorId: body.connectorId, idTag: session.idTag })
          .then((response) => response.status)
          .catch((error: Error) => `failed: ${error.message}`);
      }
    }

    runtimeFor(ctx, charger.siteId).loop.request('session_declared');
    return reply.code(201).send(ok({ ...session, remoteStart }));
  });

  /**
   * What each mode would mean for this car, before the driver commits. The estimate runs the real
   * scheduler for one car on top of the load already planned, so the numbers are the ones the
   * optimiser would actually produce rather than a rule of thumb.
   */
  app.post('/sessions/preview', async (request) => {
    const body = sessionPreviewSchema.parse(request.body);
    const site = await ctx.repos.sites.get(body.siteId);
    if (!site) throw new NotFoundError('site', body.siteId);

    const nowMs = ctx.clock.now();
    const deadlineMs = Date.parse(body.deadlineAt);
    const grid = createSlotGrid({
      nowMs,
      slotMinutes: ctx.config.SLOT_MINUTES,
      horizonHours: ctx.config.HORIZON_HOURS,
    });
    const signals = await ctx.forecast.signals(site, grid);
    const check = checkDeadline({
      startMs: nowMs,
      deadlineMs,
      energyKwh: body.energyKwh,
      maxPowerKw: body.maxPowerKw,
    });

    const plan = runtimeFor(ctx, body.siteId).loop.latestPlan;
    const alreadyPlannedKw =
      plan && plan.grid.startMs === grid.startMs && plan.siteLoadKw.length === grid.slots
        ? plan.siteLoadKw
        : baseLoadForGrid(site, grid);
    const availableHours = windowHours(grid, nowMs, deadlineMs);

    const modes = await Promise.all(
      CHARGING_MODES.map(async (mode) => {
        const result = await solveGreedy({
          grid,
          sessions: [
            {
              sessionId: 'preview',
              energyKwh: body.energyKwh,
              maxPowerKw: body.maxPowerKw,
              availableHours,
              weights: MODE_WEIGHTS[mode],
            },
          ],
          site: {
            gridConnectionKw: site.gridConnectionKw,
            baseLoadKw: alreadyPlannedKw,
            peakWeight: MODE_WEIGHTS[site.defaultMode].peak,
          },
          signals: { carbonGPerKwh: signals.carbonGPerKwh, pricePerKwh: signals.pricePerKwh },
        });
        const row = result.allocationsKw.preview ?? [];
        const lastSlot = row.reduce((last, kw, slot) => (kw > 0 ? slot : last), -1);
        const renewableKwh = row.reduce(
          (total, kw, slot) => total + kw * (availableHours[slot] ?? 0) * (signals.renewableShare[slot] ?? 0),
          0,
        );
        return {
          mode,
          cost: round(result.totals.cost, 3),
          co2Kg: round(result.totals.co2Kg, 3),
          energyKwh: round(result.totals.energyKwh, 2),
          renewableShare: result.totals.energyKwh > 0 ? round(renewableKwh / result.totals.energyKwh, 3) : 0,
          finishByMs: lastSlot < 0 ? null : slotEndMs(grid, lastSlot),
          shortfallKwh: result.shortfalls[0]?.shortfallKwh ?? 0,
        };
      }),
    );

    return ok({
      feasible: check.feasible,
      earliestDeadlineAt: new Date(check.earliestFinishMs).toISOString(),
      maxDeliverableKwh: round(check.maxDeliverableKwh, 1),
      slackHours: round(check.slackHours, 2),
      modes,
    });
  });

  app.get('/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const session = await ctx.repos.sessions.get(id);
    if (!session) throw new NotFoundError('session', id);
    requireSessionAccess(request.principal, session);
    const plan = runtimeForSession(ctx, session.siteId)?.loop.latestPlan ?? null;
    return ok({
      session,
      remainingKwh: ctx.sessions.remainingKwh(session),
      plannedKw: plan?.allocationsKw[session.id] ?? null,
      planGrid: plan?.grid ?? null,
    });
  });

  app.patch('/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = updateSessionSchema.parse(request.body);
    const session = await ctx.repos.sessions.get(id);
    if (!session) throw new NotFoundError('session', id);
    requireSessionAccess(request.principal, session);

    if (body.deadlineAt !== undefined || body.energyKwh !== undefined) {
      const deadlineMs = body.deadlineAt === undefined ? session.deadlineMs : Date.parse(body.deadlineAt);
      // A new total need still only has to cover what has not been delivered yet.
      const remainingKwh =
        body.energyKwh === undefined
          ? ctx.sessions.remainingKwh(session)
          : Math.max(0, body.energyKwh - session.energyDeliveredKwh);
      const check = checkDeadline({
        startMs: ctx.clock.now(),
        deadlineMs,
        energyKwh: remainingKwh,
        maxPowerKw: session.maxPowerKw,
      });
      if (!check.feasible) {
        throw new ValidationError('deadline_unreachable', 'that change cannot be delivered in time', {
          earliestDeadlineAt: new Date(check.earliestFinishMs).toISOString(),
          maxDeliverableKwh: round(check.maxDeliverableKwh, 1),
        });
      }
    }

    const updated = await ctx.sessions.patch(id, {
      ...(body.deadlineAt === undefined ? {} : { deadlineMs: Date.parse(body.deadlineAt) }),
      ...(body.energyKwh === undefined ? {} : { energyKwh: body.energyKwh }),
      ...(body.mode === undefined ? {} : { mode: body.mode }),
    });
    runtimeForSession(ctx, session.siteId)?.loop.request('session_patched');
    return ok(updated);
  });

  /** What the session actually cost and emitted, against the dumb-charger counterfactual. */
  app.get('/sessions/:id/report', async (request) => {
    const { id } = request.params as { id: string };
    const session = await ctx.repos.sessions.get(id);
    if (!session) throw new NotFoundError('session', id);
    requireSessionAccess(request.principal, session);
    const report = await ctx.reports.provisionalFor(session);
    if (!report) throw new NotFoundError('report for session', id);
    return ok({
      ...report,
      provisional: session.status === 'active' || session.status === 'pending',
      mode: session.mode,
      chargerId: session.chargerId,
      pluggedInMs: session.pluggedInMs,
      unpluggedMs: session.unpluggedMs,
    });
  });

  app.post('/sessions/:id/stop', async (request) => {
    const { id } = request.params as { id: string };
    const session = await ctx.repos.sessions.get(id);
    if (!session) throw new NotFoundError('session', id);
    requireSessionAccess(request.principal, session);
    if (session.transactionId === null) {
      throw new AppError('not_charging', 'this session has no transaction to stop', 409);
    }
    const response = await ctx.gateway.remoteStop(session.chargerId, { transactionId: session.transactionId });
    return ok({ status: response.status });
  });
}
