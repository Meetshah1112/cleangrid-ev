import { SimClock, clockControlSchema } from '@cleangrid/shared';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors';
import { requireRole } from '../auth';
import type { ApiContext } from '../context';
import { ok } from '../app';

/** Health, the shared clock, and the demo clock control. */
export async function registerSystemRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/health', async () => {
    const sessions = await ctx.repos.sessions.listActive(ctx.siteId);
    return ok({
      status: 'ok',
      nowMs: ctx.clock.now(),
      nowIso: new Date(ctx.clock.now()).toISOString(),
      timeScale: ctx.clock.scale,
      chargersOnline: ctx.gateway.onlineCount(),
      activeSessions: sessions.length,
      lastPlanMs: ctx.loop.latestPlan?.solvedMs ?? null,
      scheduler: ctx.loop.latestPlan?.solver ?? null,
    });
  });

  /** The simulator syncs to this so hardware and server agree on "now" in a sped-up demo. */
  app.get('/clock', async () =>
    ok({ nowMs: ctx.clock.now(), scale: ctx.clock.scale, iso: new Date(ctx.clock.now()).toISOString() }),
  );

  app.post('/admin/clock', async (request) => {
    requireRole(request.principal, 'operator');
    const body = clockControlSchema.parse(request.body);
    if (!(ctx.clock instanceof SimClock)) {
      throw new AppError('clock_not_simulated', 'this server runs on real time', 409);
    }
    if (body.nowAt !== undefined) ctx.clock.jumpTo(Date.parse(body.nowAt));
    if (body.scale !== undefined) ctx.clock.setScale(body.scale);
    ctx.loop.request('clock_changed');
    return ok(ctx.clock.snapshot());
  });
}
