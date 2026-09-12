import { createFlexEventSchema, flexResponseSchema, round, type FlexEvent } from '@cleangrid/shared';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError } from '../../errors';
import { requireRole, requireSite } from '../auth';
import { runtimeFor, type ApiContext } from '../context';
import { ok } from '../app';

/**
 * Grid flex: a network operator asks a site to keep under a lower cap for a window. An accepted
 * request becomes a per-slot ceiling in the next solve, so the cars reshuffle around it rather
 * than being cut off.
 */
export async function registerFlexRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  app.get('/grid/sites', async (request) => {
    requireRole(request.principal, 'grid_operator', 'operator');
    const sites = await ctx.repos.sites.list();
    return ok(
      await Promise.all(
        sites.map(async (site) => {
          const sessions = await ctx.repos.sessions.listActive(site.id);
          const chargingKw = sessions.reduce((total, session) => total + session.currentPowerKw, 0);
          const plan = ctx.runtimes.get(site.id)?.loop.latestPlan ?? null;
          const baseKw = plan?.baseLoadKw[0] ?? 0;
          return {
            siteId: site.id,
            name: site.name,
            gridConnectionKw: site.gridConnectionKw,
            currentDrawKw: round(baseKw + chargingKw, 2),
            chargingKw: round(chargingKw, 2),
            plannedPeakKw: plan?.totals.peakKw ?? null,
            /** How much of the current charging load could be moved without missing a deadline. */
            flexibleKw: round(
              sessions
                .filter((session) => !session.deadlineRisk)
                .reduce((total, session) => total + session.currentPowerKw, 0),
              2,
            ),
            carsPluggedIn: sessions.length,
          };
        }),
      ),
    );
  });

  app.post('/grid/flex-events', async (request, reply) => {
    requireRole(request.principal, 'grid_operator');
    const body = createFlexEventSchema.parse(request.body);
    const site = await ctx.repos.sites.get(body.siteId);
    if (!site) throw new NotFoundError('site', body.siteId);

    // A site under a flexibility contract honours the request automatically; otherwise an
    // operator has to accept it, and the request sits in their queue until they do.
    const automatic = ctx.config.AUTO_ACCEPT_FLEX;
    const event: FlexEvent = {
      id: randomUUID(),
      siteId: body.siteId,
      requestedBy: request.principal.id,
      startsMs: Date.parse(body.startsAt),
      endsMs: Date.parse(body.endsAt),
      capKw: body.capKw,
      reason: body.reason ?? null,
      status: automatic ? 'accepted' : 'requested',
      createdMs: ctx.clock.now(),
      respondedMs: automatic ? ctx.clock.now() : null,
    };
    const saved = await ctx.repos.flex.save(event);
    ctx.bus.emit('flex.updated', { flex: saved });
    return reply.code(201).send(ok(saved));
  });

  app.get('/grid/flex-events', async (request) => {
    requireRole(request.principal, 'grid_operator', 'operator');
    const query = request.query as { siteId?: string };
    const events = query.siteId ? await ctx.repos.flex.listBySite(query.siteId) : await ctx.repos.flex.list();
    return ok(events.sort((a, b) => b.createdMs - a.createdMs));
  });

  app.get('/sites/:siteId/flex-events', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireRole(request.principal, 'operator', 'grid_operator');
    requireSite(request.principal, siteId);
    return ok(await ctx.repos.flex.listBySite(siteId));
  });

  /** The operator decides. Accepting tightens the cap; declining leaves the plan alone. */
  app.post('/sites/:siteId/flex-events/:eventId/respond', async (request) => {
    const { siteId, eventId } = request.params as { siteId: string; eventId: string };
    requireRole(request.principal, 'operator');
    requireSite(request.principal, siteId);
    const body = flexResponseSchema.parse(request.body);
    const event = await ctx.repos.flex.get(eventId);
    if (!event || event.siteId !== siteId) throw new NotFoundError('flex event', eventId);
    // An operator can still pull out of a request the site accepted automatically, until it ends.
    if (event.status !== 'requested' && event.status !== 'accepted') {
      throw new ConflictError('already_answered', `this request is already ${event.status}`);
    }
    if (event.endsMs <= ctx.clock.now()) throw new ConflictError('already_over', 'this window has already passed');
    const updated = await ctx.repos.flex.update(eventId, {
      status: body.accept ? 'accepted' : 'declined',
      respondedMs: ctx.clock.now(),
    });
    ctx.bus.emit('flex.updated', { flex: updated });
    return ok(updated);
  });
}
