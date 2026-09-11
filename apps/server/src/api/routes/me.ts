import { createVehicleSchema, type Vehicle } from '@cleangrid/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireRole } from '../auth';
import type { ApiContext } from '../context';
import { ok } from '../app';

/** Who am I, what do I drive, and what have I charged. */
export async function registerMeRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/me', async (request) => {
    const profile = await ctx.repos.profiles.get(request.principal.id);
    return ok({
      id: request.principal.id,
      role: request.principal.role,
      displayName: profile?.displayName ?? request.principal.displayName,
      siteId: profile?.siteId ?? request.principal.siteId,
      defaultMode: profile?.defaultMode ?? 'balanced',
      idTag: profile?.idTag ?? null,
    });
  });

  app.get('/vehicles', async (request) => {
    requireRole(request.principal, 'driver');
    return ok(await ctx.repos.vehicles.listByDriver(request.principal.id));
  });

  app.post('/vehicles', async (request, reply) => {
    requireRole(request.principal, 'driver');
    const body = createVehicleSchema.parse(request.body);
    const vehicle: Vehicle = {
      id: randomUUID(),
      driverId: request.principal.id,
      label: body.label,
      batteryKwh: body.batteryKwh,
      maxChargeKw: body.maxChargeKw,
    };
    return reply.code(201).send(ok(await ctx.repos.vehicles.save(vehicle)));
  });

  /** A driver's own history, newest first, with the impact report where one exists. */
  app.get('/sessions', async (request) => {
    requireRole(request.principal, 'driver');
    const query = request.query as { limit?: string };
    const sessions = await ctx.repos.sessions.listByDriver(
      request.principal.id,
      Math.min(100, Math.max(1, Number(query.limit ?? 20))),
    );
    const reports = await ctx.repos.reports.list(sessions.map((session) => session.id));
    const byId = new Map(reports.map((report) => [report.sessionId, report]));
    return ok(
      sessions.map((session) => ({
        ...session,
        remainingKwh: ctx.sessions.remainingKwh(session),
        report: byId.get(session.id) ?? null,
      })),
    );
  });

  app.get('/sessions/current', async (request) => {
    requireRole(request.principal, 'driver');
    const sessions = await ctx.repos.sessions.listByDriver(request.principal.id, 10);
    const current = sessions.find((session) => session.status === 'active' || session.status === 'pending') ?? null;
    if (!current) return ok(null);
    const plan = ctx.loop.latestPlan;
    return ok({
      session: current,
      remainingKwh: ctx.sessions.remainingKwh(current),
      plannedKw: plan?.allocationsKw[current.id] ?? null,
      planGrid: plan?.grid ?? null,
    });
  });
}
