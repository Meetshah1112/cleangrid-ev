import { ManualClock, type Charger, type UserProfile, type Vehicle } from '@cleangrid/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../events';
import { nullLogger } from '../logger';
import { createMemoryRepositories } from '../repo/memory';
import type { Repositories } from '../repo/types';
import { SessionService } from './service';

const nowMs = Date.parse('2026-09-12T08:00:00Z');

const charger: Charger = {
  id: 'CP-01',
  siteId: 'site',
  ocppIdentity: 'CP-01',
  label: 'Bay 1',
  maxPowerKw: 22,
  minPowerKw: 1.4,
  connectorCount: 1,
  online: true,
  lastSeenMs: nowMs,
  vendor: null,
  model: null,
  uncontrolled: false,
};

const driver: UserProfile = {
  id: 'drv-amara',
  role: 'driver',
  displayName: 'Amara Okafor',
  siteId: 'site',
  idTag: 'TAG-AMARA',
  defaultMode: 'cheapest',
  defaultDwellHours: 9,
  defaultEnergyKwh: 18,
};

const vehicle: Vehicle = { id: 'veh', driverId: 'drv-amara', label: 'Leaf', batteryKwh: 40, maxChargeKw: 6.6 };

describe('SessionService', () => {
  let repos: Repositories;
  let clock: ManualClock;
  let bus: EventBus;
  let service: SessionService;

  beforeEach(async () => {
    repos = createMemoryRepositories();
    clock = new ManualClock(nowMs);
    bus = new EventBus();
    service = new SessionService({ repos, bus, clock, logger: nullLogger() });
    await repos.chargers.save(charger);
    await repos.profiles.save(driver);
    await repos.vehicles.save(vehicle);
  });

  it('attaches a charger transaction to the session the driver declared', async () => {
    const declared = await service.declareIntent({
      siteId: 'site',
      chargerId: 'CP-01',
      connectorId: 1,
      driverId: driver.id,
      vehicleId: vehicle.id,
      idTag: driver.idTag as string,
      energyKwh: 18,
      deadlineMs: nowMs + 9 * 3_600_000,
      mode: 'balanced',
      source: 'app',
      maxPowerKw: 6.6,
    });
    expect(declared.status).toBe('pending');

    const { session, transactionId } = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 5_000,
      tsMs: nowMs + 60_000,
    });
    expect(session.id).toBe(declared.id);
    expect(session.status).toBe('active');
    expect(session.transactionId).toBe(transactionId);
    expect(session.meterStartWh).toBe(5_000);
    expect(session.deadlineMs).toBe(declared.deadlineMs);
  });

  it('opens a session from driver defaults for a walk-up RFID tap', async () => {
    const { session } = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 0,
      tsMs: nowMs,
    });
    expect(session.source).toBe('rfid');
    expect(session.energyNeededKwh).toBe(18);
    expect(session.mode).toBe('cheapest');
    expect(session.deadlineIsDefault).toBe(true);
    // Deadline is plug-in plus the driver's usual dwell time.
    expect(session.deadlineMs).toBe(nowMs + 9 * 3_600_000);
    expect(session.maxPowerKw).toBe(6.6);
  });

  it('turns meter registers into delivered energy and current power', async () => {
    const { session, transactionId } = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 1_000,
      tsMs: nowMs,
    });
    const updated = await service.recordMeter({
      transactionId,
      tsMs: nowMs + 900_000,
      energyWh: 2_650,
      powerW: 6_600,
      soc: 0.42,
    });
    expect(updated?.energyDeliveredKwh).toBe(1.65);
    expect(updated?.currentPowerKw).toBe(6.6);
    expect(service.remainingKwh(updated!)).toBeCloseTo(16.35, 6);
    expect(await repos.meters.listBySession(session.id)).toHaveLength(1);
  });

  it('refuses a meter register that goes backwards instead of inventing energy', async () => {
    const { transactionId } = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 5_000,
      tsMs: nowMs,
    });
    await service.recordMeter({ transactionId, tsMs: nowMs + 60_000, energyWh: 6_000, powerW: 1_000, soc: null });
    const after = await service.recordMeter({ transactionId, tsMs: nowMs + 120_000, energyWh: 100, powerW: 0, soc: null });
    expect(after?.energyDeliveredKwh).toBe(1);
  });

  it('closes the session on StopTransaction and reports the final energy', async () => {
    const { transactionId } = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 0,
      tsMs: nowMs,
    });
    const ended = await service.stopTransaction({
      transactionId,
      meterStopWh: 18_000,
      tsMs: nowMs + 4 * 3_600_000,
      reason: 'EVDisconnected',
    });
    expect(ended?.status).toBe('complete');
    expect(ended?.energyDeliveredKwh).toBe(18);
    expect(ended?.currentPowerKw).toBe(0);
  });

  it('lets a driver move the deadline but not into the past', async () => {
    const { session } = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 0,
      tsMs: nowMs,
    });
    const patched = await service.patch(session.id, { deadlineMs: nowMs + 3 * 3_600_000, mode: 'greenest' });
    expect(patched.mode).toBe('greenest');
    expect(patched.deadlineIsDefault).toBe(false);
    await expect(service.patch(session.id, { deadlineMs: nowMs - 1 })).rejects.toThrow(/future/);
  });

  it('closes a session left open on the connector when a new transaction starts', async () => {
    const first = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 0,
      tsMs: nowMs,
    });
    const second = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 0,
      tsMs: nowMs + 60_000,
    });
    expect(second.session.id).not.toBe(first.session.id);
    expect((await repos.sessions.get(first.session.id))?.status).toBe('aborted');
    expect((await repos.sessions.listActive('site')).map((s) => s.id)).toEqual([second.session.id]);
  });

  it('announces what happened on the event bus', async () => {
    const seen: string[] = [];
    bus.on('session.created', () => seen.push('created'));
    bus.on('session.updated', ({ reason }) => seen.push(`updated:${reason}`));
    bus.on('session.ended', () => seen.push('ended'));

    const { transactionId } = await service.startTransaction({
      chargerId: 'CP-01',
      connectorId: 1,
      idTag: 'TAG-AMARA',
      meterStartWh: 0,
      tsMs: nowMs,
    });
    await service.stopTransaction({ transactionId, meterStopWh: 1_000, tsMs: nowMs + 60_000 });
    expect(seen).toEqual(['created', 'updated:transaction_started', 'ended']);
  });
});
