import { MS_PER_HOUR, round, sampleSeries, valueAtClamped } from '@cleangrid/shared';
import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../../errors';
import { requireRole, requireSite } from '../auth';
import { runtimeFor, type ApiContext } from '../context';
import { ok } from '../app';

/** The operator-facing side: what the site is doing now and what the plan says it will do. */
export async function registerSiteRoutes(app: FastifyInstance, ctx: ApiContext): Promise<void> {
  const loadSite = async (siteId: string) => {
    const site = await ctx.repos.sites.get(siteId);
    if (!site) throw new NotFoundError('site', siteId);
    return site;
  };

  /** Every signed-in user needs to know which sites exist; a driver picks one to charge at. */
  app.get('/sites', async () => ok(await ctx.repos.sites.list()));

  app.get('/sites/:siteId/forecast', async (request) => {
    const { siteId } = request.params as { siteId: string };
    const site = await loadSite(siteId);
    const query = request.query as { hours?: string };
    const hours = Math.min(48, Math.max(1, Number(query.hours ?? 24)));
    const snapshot = await ctx.forecast.snapshot(site);
    const startMs = ctx.clock.now();
    const steps = hours * 4;

    const carbon = sampleSeries(snapshot.carbon, startMs, 15, steps);
    const renewable = sampleSeries(snapshot.renewable, startMs, 15, steps);
    const price = sampleSeries(snapshot.price, startMs, 15, steps);
    return ok({
      startMs,
      stepMinutes: 15,
      carbonGPerKwh: carbon,
      pricePerKwh: price,
      renewableShare: renewable,
      sources: snapshot.sources,
      notes: snapshot.notes,
      greenWindow: greenestWindow(startMs, carbon, renewable),
    });
  });

  app.get('/sites/:siteId/overview', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireRole(request.principal, 'operator', 'grid_operator');
    requireSite(request.principal, siteId);
    const site = await loadSite(siteId);
    const [sessions, chargers, snapshot] = await Promise.all([
      ctx.repos.sessions.listActive(siteId),
      ctx.repos.chargers.listBySite(siteId),
      ctx.forecast.snapshot(site),
    ]);
    const { loop } = runtimeFor(ctx, siteId);
    const plan = loop.latestPlan;
    const nowMs = ctx.clock.now();
    const chargingKw = sessions.reduce((total, session) => total + session.currentPowerKw, 0);
    const baseKw = plan?.baseLoadKw[0] ?? 0;

    return ok({
      siteId,
      nowMs,
      currency: site.currency,
      gridConnectionKw: site.gridConnectionKw,
      siteDemandKw: round(baseKw + chargingKw, 2),
      chargingKw: round(chargingKw, 2),
      baseLoadKw: round(baseKw, 2),
      headroomKw: round(site.gridConnectionKw - baseKw - chargingKw, 2),
      carsCharging: sessions.filter((session) => session.currentPowerKw > 0.05).length,
      carsPluggedIn: sessions.length,
      carsAtRisk: sessions.filter((session) => session.deadlineRisk).length,
      chargersOnline: chargers.filter((charger) => charger.online).length,
      chargersTotal: chargers.length,
      carbonGPerKwh: round(valueAtClamped(snapshot.carbon, nowMs), 1),
      renewableShare: round(valueAtClamped(snapshot.renewable, nowMs), 3),
      pricePerKwh: round(valueAtClamped(snapshot.price, nowMs), 4),
      peakSoFarKw: round(loop.peakKw, 2),
      plannedPeakKw: plan?.totals.peakKw ?? null,
      plannedCost: plan?.totals.cost ?? null,
      plannedCo2Kg: plan?.totals.co2Kg ?? null,
      plannedEnergyKwh: plan?.totals.energyKwh ?? null,
      lastPlanMs: plan?.solvedMs ?? null,
      solver: plan?.solver ?? null,
      planStatus: plan?.status ?? null,
    });
  });

  /** Verified impact over a period: energy, cost and CO2 against what dumb charging would have done. */
  app.get('/sites/:siteId/reports', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireRole(request.principal, 'operator', 'grid_operator');
    requireSite(request.principal, siteId);
    const site = await loadSite(siteId);
    const query = request.query as { from?: string; to?: string };
    const toMs = query.to ? Date.parse(query.to) : ctx.clock.now() + MS_PER_HOUR;
    const fromMs = query.from ? Date.parse(query.from) : toMs - 30 * 24 * MS_PER_HOUR;
    const impact = await ctx.reports.siteImpact(site, fromMs, toMs);
    return ok({
      ...impact,
      fromMs,
      toMs,
      peakKw: round(runtimeFor(ctx, siteId).loop.peakKw, 2),
      currency: site.currency,
      gridConnectionKw: site.gridConnectionKw,
    });
  });

  app.get('/sites/:siteId/dispatch-log', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireRole(request.principal, 'operator');
    requireSite(request.principal, siteId);
    const query = request.query as { limit?: string };
    return ok(await ctx.repos.dispatches.listBySite(siteId, Math.min(500, Math.max(1, Number(query.limit ?? 50)))));
  });

  /** What the site actually drew, interval by interval, against its connection. */
  app.get('/sites/:siteId/demand', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireRole(request.principal, 'operator', 'grid_operator');
    requireSite(request.principal, siteId);
    const site = await loadSite(siteId);
    const query = request.query as { hours?: string };
    const hours = Math.min(48, Math.max(1, Number(query.hours ?? 24)));
    const toMs = ctx.clock.now();
    const fromMs = toMs - hours * MS_PER_HOUR;
    return ok({
      fromMs,
      toMs,
      stepMinutes: ctx.config.SLOT_MINUTES,
      gridConnectionKw: site.gridConnectionKw,
      peakKw: round(runtimeFor(ctx, siteId).loop.peakKw, 2),
      intervals: runtimeFor(ctx, siteId).demand.history(fromMs, toMs),
    });
  });

  app.get('/sites/:siteId/plans/latest', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireRole(request.principal, 'operator', 'grid_operator');
    requireSite(request.principal, siteId);
    const plan = runtimeFor(ctx, siteId).loop.latestPlan ?? (await ctx.repos.plans.latest(siteId));
    if (!plan) throw new NotFoundError('plan for site', siteId);
    return ok(plan);
  });

  app.get('/sites/:siteId/sessions', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireRole(request.principal, 'operator', 'grid_operator');
    requireSite(request.principal, siteId);
    const query = request.query as { status?: string; limit?: string };
    const sessions = await ctx.repos.sessions.listBySite(siteId, {
      ...(query.status === undefined ? {} : { status: query.status as 'pending' }),
      limit: Math.min(500, Math.max(1, Number(query.limit ?? 100))),
    });
    const drivers = await ctx.repos.profiles.list();
    const names = new Map(drivers.map((profile) => [profile.id, profile.displayName]));
    return ok(
      sessions.map((session) => ({
        ...session,
        driverName: session.driverId ? (names.get(session.driverId) ?? session.driverId) : null,
        remainingKwh: ctx.sessions.remainingKwh(session),
      })),
    );
  });

  /** Drivers need this too: it is how they choose which bay they are standing at. */
  app.get('/sites/:siteId/chargers', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireSite(request.principal, siteId);
    const chargers = await ctx.repos.chargers.listBySite(siteId);
    return ok(
      await Promise.all(
        chargers.map(async (charger) => ({
          ...charger,
          connectors: await ctx.repos.connectors.listByCharger(charger.id),
        })),
      ),
    );
  });

  app.post('/sites/:siteId/replan', async (request) => {
    const { siteId } = request.params as { siteId: string };
    requireRole(request.principal, 'operator');
    requireSite(request.principal, siteId);
    const plan = await runtimeFor(ctx, siteId).loop.solve('operator_request');
    return ok(plan === null ? { queued: true } : { planId: plan.id, status: plan.status, solver: plan.solver });
  });
}

/** The cleanest three-hour stretch ahead, which is what the driver app suggests. */
function greenestWindow(
  startMs: number,
  carbon: readonly number[],
  renewable: readonly number[],
): { startMs: number; endMs: number; avgCarbonGPerKwh: number; avgRenewableShare: number } | null {
  const width = 12;
  if (carbon.length < width) return null;
  let bestIndex = 0;
  let bestSum = Number.POSITIVE_INFINITY;
  for (let index = 0; index + width <= carbon.length; index += 1) {
    const sum = carbon.slice(index, index + width).reduce((total, value) => total + value, 0);
    if (sum < bestSum) {
      bestSum = sum;
      bestIndex = index;
    }
  }
  const slice = renewable.slice(bestIndex, bestIndex + width);
  return {
    startMs: startMs + bestIndex * 15 * 60_000,
    endMs: startMs + (bestIndex + width) * 15 * 60_000,
    avgCarbonGPerKwh: round(bestSum / width, 1),
    avgRenewableShare: round(slice.reduce((total, value) => total + value, 0) / width, 3),
  };
}

export const HOUR_MS = MS_PER_HOUR;
