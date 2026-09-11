import type { Clock, SiteEvent } from '@cleangrid/shared';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { EventBus } from '../events';
import type { Logger } from '../logger';
import type { Repositories } from '../repo/types';

/**
 * Live updates for the operator dashboard on /ws/sites/<siteId>. Dashboards fetch their initial
 * state over REST and then follow this channel, falling back to polling if it drops.
 */

export const WS_PATH_PREFIX = '/ws/sites/';
const CLOCK_TICK_MS = 5_000;

export interface DashboardChannelDeps {
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly repos: Repositories;
  readonly logger: Logger;
}

export class DashboardChannel {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly clients = new Map<WebSocket, string>();
  private unsubscribe: (() => void)[] = [];
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: DashboardChannelDeps) {}

  get clientCount(): number {
    return this.clients.size;
  }

  start(): void {
    const { bus } = this.deps;
    const send = (siteId: string, event: SiteEvent): void => this.broadcast(siteId, event);

    this.unsubscribe = [
      bus.on('session.created', ({ session }) => send(session.siteId, { type: 'session.updated', session })),
      bus.on('session.updated', ({ session }) => send(session.siteId, { type: 'session.updated', session })),
      bus.on('session.ended', ({ session }) => send(session.siteId, { type: 'session.updated', session })),
      bus.on('meter.updated', ({ session }) =>
        send(session.siteId, {
          type: 'meter.updated',
          sessionId: session.id,
          chargerId: session.chargerId,
          powerKw: session.currentPowerKw,
          energyKwh: session.energyDeliveredKwh,
          tsMs: session.updatedMs,
        }),
      ),
      bus.on('charger.connected', ({ charger }) => void this.sendCharger(charger.id)),
      bus.on('charger.disconnected', ({ charger }) => void this.sendCharger(charger.id)),
      bus.on('charger.status', ({ charger }) => void this.sendCharger(charger.id)),
      bus.on('plan.solved', ({ plan }) => send(plan.siteId, { type: 'plan.solved', plan })),
      bus.on('dispatch.sent', ({ dispatch }) => send(dispatch.siteId, { type: 'dispatch.sent', dispatch })),
      bus.on('flex.updated', ({ flex }) => send(flex.siteId, { type: 'flex.updated', flex })),
      bus.on('report.ready', ({ report }) => void this.sendReport(report.sessionId)),
      bus.on('forecast.updated', ({ forecast }) => this.broadcastAll({ type: 'forecast.updated', forecast })),
    ];

    this.ticker = setInterval(() => {
      this.broadcastAll({ type: 'clock.tick', nowMs: this.deps.clock.now(), scale: this.deps.clock.scale });
    }, CLOCK_TICK_MS);
    this.ticker.unref?.();
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, siteId: string): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.clients.set(ws, siteId);
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      ws.send(
        JSON.stringify({ type: 'clock.tick', nowMs: this.deps.clock.now(), scale: this.deps.clock.scale } satisfies SiteEvent),
      );
      this.deps.logger.debug({ siteId, clients: this.clients.size }, 'dashboard connected');
    });
  }

  async close(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    for (const client of this.clients.keys()) client.close(1001, 'server shutting down');
    this.clients.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private broadcast(siteId: string, event: SiteEvent): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify(event);
    for (const [client, clientSite] of this.clients) {
      if (clientSite !== siteId) continue;
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  private broadcastAll(event: SiteEvent): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify(event);
    for (const client of this.clients.keys()) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  private async sendCharger(chargerId: string): Promise<void> {
    const charger = await this.deps.repos.chargers.get(chargerId);
    if (!charger) return;
    const connectors = await this.deps.repos.connectors.listByCharger(chargerId);
    this.broadcast(charger.siteId, { type: 'charger.updated', charger, connectors });
  }

  private async sendReport(sessionId: string): Promise<void> {
    const [report, session] = await Promise.all([
      this.deps.repos.reports.get(sessionId),
      this.deps.repos.sessions.get(sessionId),
    ]);
    if (report && session) this.broadcast(session.siteId, { type: 'report.ready', report });
  }
}
