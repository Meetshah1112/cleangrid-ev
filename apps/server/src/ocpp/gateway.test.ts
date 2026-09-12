import { OCPP_SUBPROTOCOL, OcppRpc, buildMeterValue, type Payload } from '@cleangrid/ocpp';
import { ManualClock, type Charger, type UserProfile } from '@cleangrid/shared';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { EventBus } from '../events';
import { nullLogger } from '../logger';
import { createMemoryRepositories } from '../repo/memory';
import type { Repositories } from '../repo/types';
import { SessionService } from '../sessions/service';
import { OcppGateway, SAFETY_PROFILE_ID } from './gateway';

/**
 * End to end over a real WebSocket: a charge point connects, authorises a card, opens a
 * transaction, reports meter values and stops. This is the path a real charger takes, so it is
 * tested against the real socket rather than by calling handlers directly.
 */

const nowMs = Date.parse('2026-09-12T08:00:00Z');

const charger: Charger = {
  id: 'CP-01',
  siteId: 'site-riverside',
  ocppIdentity: 'CP-01',
  label: 'Bay 1',
  maxPowerKw: 22,
  minPowerKw: 1.4,
  connectorCount: 1,
  online: false,
  lastSeenMs: null,
  vendor: null,
  model: null,
  uncontrolled: false,
};

const driver: UserProfile = {
  id: 'drv-amara',
  role: 'driver',
  displayName: 'Amara Okafor',
  siteId: 'site-riverside',
  idTag: 'TAG-AMARA',
  defaultMode: 'balanced',
  defaultDwellHours: 8,
  defaultEnergyKwh: 18,
};

interface Harness {
  readonly server: Server;
  readonly gateway: OcppGateway;
  readonly repos: Repositories;
  readonly bus: EventBus;
  readonly clock: ManualClock;
  readonly port: number;
}

async function startHarness(): Promise<Harness> {
  const repos = createMemoryRepositories();
  const bus = new EventBus();
  const clock = new ManualClock(nowMs);
  const logger = nullLogger();
  await repos.chargers.save(charger);
  await repos.profiles.save(driver);
  await repos.sites.save({
    id: 'site-riverside',
    name: 'Riverside',
    timezone: 'Europe/London',
  country: 'GB',
    lat: 51.5,
    lng: -0.12,
    regionCode: 'C',
    gridConnectionKw: 65,
    demandChargePerKwMonth: 12,
    currency: 'GBP',
    defaultMode: 'balanced',
    baseLoadKw: Array<number>(24).fill(10),
  });

  const sessions = new SessionService({ repos, bus, clock, logger });
  const gateway = new OcppGateway({ repos, bus, clock, logger, sessions, callTimeoutMs: 2_000 });
  const server = createServer();
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { server, gateway, repos, bus, clock, port };
}

interface ChargePointClient {
  readonly rpc: OcppRpc;
  readonly socket: WebSocket;
  readonly received: { action: string; payload: Payload }[];
  close: () => Promise<void>;
}

async function connectChargePoint(port: number, identity = 'CP-01'): Promise<ChargePointClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ocpp/${identity}`, [OCPP_SUBPROTOCOL]);
  const received: { action: string; payload: Payload }[] = [];
  const rpc = new OcppRpc(
    (data) => socket.send(data),
    (action, payload) => {
      received.push({ action, payload });
      if (action === 'SetChargingProfile') return { status: 'Accepted' };
      if (action === 'ClearChargingProfile') return { status: 'Accepted' };
      return {};
    },
    { callTimeoutMs: 2_000 },
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('message', (data) => void rpc.receive(data.toString()));
  return {
    rpc,
    socket,
    received,
    close: async () => {
      rpc.close('test over');
      socket.close();
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}

describe('shutting down', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => harness.server.close(() => resolve()));
  });

  it('releases the safety profile before letting the charger go', async () => {
    // A charging profile lives on the charger. Closing the socket without clearing it leaves the
    // limit in force with nothing left to lift it, and the charger stays throttled indefinitely --
    // silently, because the thing that would report it is the thing that stopped.
    const client = await connectChargePoint(harness.port);
    await client.rpc.call('BootNotification', { chargePointVendor: 'v', chargePointModel: 'm' });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(client.received.some((call) => call.action === 'SetChargingProfile')).toBe(true);

    await harness.gateway.close();
    await new Promise((resolve) => setTimeout(resolve, 60));

    const cleared = client.received.filter((call) => call.action === 'ClearChargingProfile');
    expect(cleared.length).toBe(1);
    expect(cleared[0]?.payload).toMatchObject({ id: SAFETY_PROFILE_ID });
    await client.close();
  });

  it('closes cleanly when a charger has already gone, rather than waiting on it', async () => {
    const client = await connectChargePoint(harness.port);
    await client.rpc.call('BootNotification', { chargePointVendor: 'v', chargePointModel: 'm' });
    await new Promise((resolve) => setTimeout(resolve, 60));

    // The charger drops off first, so there is nothing to hand anything back to.
    client.socket.terminate();
    await new Promise((resolve) => setTimeout(resolve, 60));

    await expect(harness.gateway.close()).resolves.toBeUndefined();
  });
});

describe('OcppGateway', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await startHarness();
  });

  afterEach(async () => {
    await harness.gateway.close();
    await new Promise<void>((resolve) => harness.server.close(() => resolve()));
  });

  it('walks a whole transaction from boot to stop', async () => {
    const client = await connectChargePoint(harness.port);

    const boot = await client.rpc.call<{ status: string; interval: number }>('BootNotification', {
      chargePointVendor: 'CleanGrid',
      chargePointModel: 'Sim',
    });
    expect(boot.status).toBe('Accepted');
    expect(boot.interval).toBeGreaterThan(0);
    expect(harness.gateway.isOnline('CP-01')).toBe(true);
    expect((await harness.repos.chargers.get('CP-01'))?.online).toBe(true);

    await client.rpc.call('StatusNotification', {
      connectorId: 1,
      errorCode: 'NoError',
      status: 'Preparing',
      timestamp: new Date(nowMs).toISOString(),
    });
    expect((await harness.repos.connectors.get('CP-01', 1))?.status).toBe('Preparing');

    const auth = await client.rpc.call<{ idTagInfo: { status: string } }>('Authorize', { idTag: 'TAG-AMARA' });
    expect(auth.idTagInfo.status).toBe('Accepted');

    const start = await client.rpc.call<{ transactionId: number; idTagInfo: { status: string } }>('StartTransaction', {
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStart: 1_000,
      timestamp: new Date(nowMs).toISOString(),
    });
    expect(start.transactionId).toBeGreaterThan(0);

    await client.rpc.call('MeterValues', {
      connectorId: 1,
      transactionId: start.transactionId,
      meterValue: [buildMeterValue({ tsMs: nowMs + 900_000, energyWh: 2_800, powerW: 7_200, soc: 0.4 })],
    });
    const charging = await harness.repos.sessions.getByTransaction(start.transactionId);
    expect(charging?.energyDeliveredKwh).toBe(1.8);
    expect(charging?.currentPowerKw).toBe(7.2);

    await client.rpc.call('StopTransaction', {
      transactionId: start.transactionId,
      idTag: 'TAG-AMARA',
      meterStop: 15_000,
      timestamp: new Date(nowMs + 3_600_000).toISOString(),
      reason: 'EVDisconnected',
    });
    const finished = await harness.repos.sessions.getByTransaction(start.transactionId);
    expect(finished?.status).toBe('complete');
    expect(finished?.energyDeliveredKwh).toBe(14);
    expect((await harness.repos.connectors.get('CP-01', 1))?.sessionId).toBeNull();

    await client.close();
  });

  it('refuses a card it does not know', async () => {
    const client = await connectChargePoint(harness.port);
    const auth = await client.rpc.call<{ idTagInfo: { status: string } }>('Authorize', { idTag: 'TAG-STRANGER' });
    expect(auth.idTagInfo.status).toBe('Invalid');
    await client.close();
  });

  it('answers a malformed payload with a protocol error rather than accepting it', async () => {
    const client = await connectChargePoint(harness.port);
    await expect(client.rpc.call('StartTransaction', { connectorId: 1 })).rejects.toMatchObject({
      errorCode: 'FormationViolation',
    });
    await client.close();
  });

  it('answers an action it does not implement with NotImplemented', async () => {
    const client = await connectChargePoint(harness.port);
    await expect(client.rpc.call('DiagnosticsStatusNotification', {})).rejects.toMatchObject({
      errorCode: 'NotImplemented',
    });
    await client.close();
  });

  it('sends a charging profile to a connected charger and marks it offline when it drops', async () => {
    const client = await connectChargePoint(harness.port);
    await client.rpc.call('BootNotification', { chargePointVendor: 'CleanGrid', chargePointModel: 'Sim' });
    const response = await harness.gateway.setChargingProfile('CP-01', {
      connectorId: 1,
      csChargingProfiles: {
        chargingProfileId: 1,
        stackLevel: 1,
        chargingProfilePurpose: 'TxProfile',
        chargingProfileKind: 'Absolute',
        chargingSchedule: { chargingRateUnit: 'W', chargingSchedulePeriod: [{ startPeriod: 0, limit: 7_400 }] },
      },
    });
    expect(response.status).toBe('Accepted');
    expect(client.received.some((message) => message.action === 'SetChargingProfile')).toBe(true);

    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.gateway.isOnline('CP-01')).toBe(false);
    expect((await harness.repos.chargers.get('CP-01'))?.online).toBe(false);
    await expect(harness.gateway.reset('CP-01')).rejects.toThrow(/offline/);
  });

  it('turns away a charge point it has never heard of', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${harness.port}/ocpp/CP-UNKNOWN`, [OCPP_SUBPROTOCOL]);
    const code = await new Promise<number>((resolve, reject) => {
      socket.once('close', resolve);
      socket.once('error', reject);
    });
    expect(code).toBe(1008);
  });
});
