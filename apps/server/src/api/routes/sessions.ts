import { checkDeadline } from '@cleangrid/engine';
import { createSessionSchema, round, updateSessionSchema } from '@cleangrid/shared';
import type { FastifyInstance } from 'fastify';
import { AppError, NotFoundError, ValidationError } from '../../errors';
import { requireSessionAccess } from '../auth';
import type { ApiContext } from '../context';
import { ok } from '../app';

/** The driver-facing side: declare a need, watch it, change it, stop it. */
export async function registerSessionRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  /**
   * Declare intent. A deadline that cannot physically be met is refused here with the earliest
   * one that can, rather than accepted and quietly missed later.
   */
  app.post('/sessions', async (request, reply) => {
    const body = createSessionSchema.parse(request.body);
    const principal = request.principal;

    const charger = await ctx.repos.chargers.get(body.chargerId);
    if (!charger) throw new NotFoundError('charger', body.chargerId);
    if (body.connectorId > charger.connectorCount) {
      throw new ValidationError('unknown_connector', `charger ${charger.id} has no connector ${body.connectorId}`);
    }

    const driverId = principal.role === 'driver' ? principal.id : (principal.id ?? null);
    const vehicle = body.vehicleId
      ? await ctx.repos.vehicles.get(body.vehicleId)
      : ((await ctx.repos.vehicles.listByDriver(driverId))[0] ?? null);
    if (body.vehicleId && !vehicle) throw new NotFoundError('vehicle', body.vehicleId);
    if (vehicle && principal.role === 'driver' && vehicle.driverId !== principal.id) {
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
    ctx.loop.request('session_declared');
    return reply.code(201).send(ok(session));
  });

  app.get('/sessions/:id', async (request) => {
    const { id } = request.params as { id: string };
    const session = await ctx.repos.sessions.get(id);
    if (!session) throw new NotFoundError('session', id);
    requireSessionAccess(request.principal, session);
    const plan = ctx.loop.latestPlan;
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
      const energyKwh = body.energyKwh ?? ctx.sessions.remainingKwh(session);
      const check = checkDeadline({
        startMs: ctx.clock.now(),
        deadlineMs,
        energyKwh: Math.max(0, energyKwh - (body.energyKwh === undefined ? 0 : session.energyDeliveredKwh)),
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
    ctx.loop.request('session_patched');
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
