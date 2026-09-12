import type { Charger, ChargingSession, SessionReport, Site, UserProfile, Vehicle } from '@cleangrid/shared';
import { describe, expect, it } from 'vitest';
import {
  chargerRow,
  profileRow,
  rowToCharger,
  rowToProfile,
  rowToReport,
  rowToSession,
  rowToSite,
  rowToVehicle,
  reportRow,
  sessionRow,
  siteRow,
  vehicleRow,
  type Row,
} from './rows';

/**
 * The mapping between domain objects and database rows, which had no tests at all.
 *
 * It is the quietest place in the system to be wrong. Everything else fails loudly — a bad plan
 * misses a deadline, a dead API degrades a label — but a field mapped to the wrong column, or a
 * numeric read as a string, writes plausible nonsense to Postgres and reports success. The server
 * would carry on answering from memory and only the stored record would be wrong, which is the
 * copy anyone would later trust.
 *
 * So these go both ways: build the object, write the row, read it back, and require what comes out
 * to be what went in.
 */

/** postgres-js hands back numerics as strings. Reads have to survive that, so the tests do it. */
const asPostgresWouldReturn = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? String(value) : value]),
  );

const site: Site = {
  id: 'site-gandhinagar-secretariat',
  name: 'Gandhinagar Secretariat Car Park',
  timezone: 'Asia/Kolkata',
  country: 'IN',
  lat: 23.2156,
  lng: 72.6369,
  regionCode: 'GJ',
  gridConnectionKw: 120,
  demandChargePerKwMonth: 385,
  currency: 'INR',
  defaultMode: 'greenest',
  baseLoadKw: [18, 16, 15, 15, 15, 17, 24, 38, 56, 68, 74, 78, 76, 78, 76, 70, 58, 42, 32, 27, 24, 22, 20, 19],
};

const charger: Charger = {
  id: 'GN-01',
  siteId: site.id,
  ocppIdentity: 'GN-01',
  label: 'Bay 1',
  maxPowerKw: 22,
  minPowerKw: 1.4,
  connectorCount: 1,
  online: true,
  lastSeenMs: Date.parse('2026-09-12T04:31:00.000Z'),
  vendor: 'CleanGrid',
  model: 'Sim-22AC',
  uncontrolled: false,
};

const profile: UserProfile = {
  id: 'drv-harsh',
  role: 'driver',
  displayName: 'Harsh Patel',
  siteId: site.id,
  idTag: 'TAG-HARSH',
  defaultMode: 'greenest',
  defaultDwellHours: 9.25,
  defaultEnergyKwh: 22,
};

const vehicle: Vehicle = {
  id: 'veh-harsh',
  driverId: 'drv-harsh',
  label: 'Tata Nexon EV 45',
  batteryKwh: 45,
  maxChargeKw: 7.2,
};

const session: ChargingSession = {
  id: '7eb97458-e0f1-4726-9e59-3e9de3fb8eb7',
  siteId: site.id,
  chargerId: 'GN-01',
  connectorId: 1,
  driverId: 'drv-harsh',
  vehicleId: 'veh-harsh',
  idTag: 'TAG-HARSH',
  transactionId: 41,
  source: 'app',
  status: 'active',
  mode: 'greenest',
  pluggedInMs: Date.parse('2026-09-12T03:05:00.000Z'),
  deadlineMs: Date.parse('2026-09-12T12:00:00.000Z'),
  deadlineIsDefault: false,
  unpluggedMs: null,
  energyNeededKwh: 22,
  energyDeliveredKwh: 4.37,
  maxPowerKw: 7.2,
  meterStartWh: 1200,
  lastMeterWh: 5570,
  currentPowerKw: 7.2,
  limitKw: 7.2,
  deadlineRisk: false,
  createdMs: Date.parse('2026-09-12T03:05:00.000Z'),
  updatedMs: Date.parse('2026-09-12T03:40:00.000Z'),
};

const report: SessionReport = {
  sessionId: session.id,
  energyKwh: 22,
  cost: 116.16,
  co2Kg: 7.92,
  renewableShare: 0.41,
  avgCarbonGPerKwh: 360,
  baselineCost: 125.4,
  baselineCo2Kg: 8.47,
  avoidedCo2Kg: 0.55,
  costSaved: 9.24,
  greenScore: 78,
  windowMinCarbonGPerKwh: 330,
  windowMaxCarbonGPerKwh: 725,
  verified: true,
  carbonBasis: 'forecast',
  computedMs: Date.parse('2026-09-12T12:01:00.000Z'),
};

describe('domain objects survive a round trip through Postgres', () => {
  it('a site', () => {
    expect(rowToSite(asPostgresWouldReturn(siteRow(site)))).toEqual(site);
  });

  it('a charger', () => {
    expect(rowToCharger(asPostgresWouldReturn(chargerRow(charger)))).toEqual(charger);
  });

  it('a profile', () => {
    expect(rowToProfile(asPostgresWouldReturn(profileRow(profile)))).toEqual(profile);
  });

  it('a vehicle', () => {
    expect(rowToVehicle(asPostgresWouldReturn(vehicleRow(vehicle)))).toEqual(vehicle);
  });

  it('a session, apart from updated_at, which the database owns', () => {
    // sessionRow deliberately does not write it: a trigger sets it on every update, and a value
    // from this process would be the time it built the row rather than the time Postgres took it.
    const back = rowToSession(asPostgresWouldReturn(sessionRow(session)));
    expect(back).toEqual({ ...session, updatedMs: 0 });
  });

  it('a session report', () => {
    expect(rowToReport(asPostgresWouldReturn(reportRow(report)))).toEqual(report);
  });
});

describe('the conversions that are easy to get wrong', () => {
  it('keeps a timestamp to the millisecond through ISO and back', () => {
    const odd = { ...session, pluggedInMs: Date.parse('2026-09-12T03:05:07.123Z') };
    expect(rowToSession(sessionRow(odd)).pluggedInMs).toBe(odd.pluggedInMs);
  });

  it('reads a numeric that arrived as a string', () => {
    const row = { ...siteRow(site), grid_connection_kw: '120.00', lat: '23.2156' };
    const back = rowToSite(row);
    expect(back.gridConnectionKw).toBe(120);
    expect(back.lat).toBeCloseTo(23.2156, 6);
  });

  it('reads a numeric array that arrived as strings', () => {
    const row = { ...siteRow(site), base_load_kw: ['18.0', '16.0', '15.5'] };
    expect(rowToSite(row).baseLoadKw).toEqual([18, 16, 15.5]);
  });

  it('keeps null apart from zero, because they mean different things', () => {
    // A session with no limit is unconstrained; one limited to zero is being held. Reading either
    // as the other inverts what the row says about the car.
    const held = rowToSession(sessionRow({ ...session, limitKw: 0 }));
    const free = rowToSession(sessionRow({ ...session, limitKw: null }));
    expect(held.limitKw).toBe(0);
    expect(free.limitKw).toBeNull();

    const unstarted = rowToSession(sessionRow({ ...session, meterStartWh: null, transactionId: null }));
    expect(unstarted.meterStartWh).toBeNull();
    expect(unstarted.transactionId).toBeNull();
  });

  it('does not turn a missing timestamp into 1970', () => {
    expect(rowToSession(sessionRow({ ...session, unpluggedMs: null })).unpluggedMs).toBeNull();
  });

  it('reads a carbon basis it does not recognise as a forecast, not as a measurement', () => {
    // The cautious direction: claiming a number was measured when it was not is the worse error.
    expect(rowToReport({ ...reportRow(report), carbon_basis: 'something-else' }).carbonBasis).toBe('forecast');
    expect(rowToReport({ ...reportRow(report), carbon_basis: 'actual' }).carbonBasis).toBe('actual');
  });

  it('survives a row with a numeric field missing rather than producing NaN', () => {
    const row = { ...siteRow(site) };
    delete row.grid_connection_kw;
    expect(rowToSite(row).gridConnectionKw).toBe(0);
    expect(Number.isNaN(rowToSite(row).gridConnectionKw)).toBe(false);
  });
});

describe('rows name the columns the schema declares', () => {
  // A column that does not exist is rejected by Postgres, but a column that exists and is never
  // written is silently left at its default, which is the failure that does not announce itself.
  it('writes every column the site table expects', () => {
    expect(Object.keys(siteRow(site)).sort()).toEqual(
      [
        'base_load_kw',
        'country',
        'currency',
        'default_mode',
        'demand_charge_per_kw_month',
        'grid_connection_kw',
        'id',
        'lat',
        'lng',
        'name',
        'region_code',
        'timezone',
      ].sort(),
    );
  });

  it('uses snake_case throughout, since Postgres does', () => {
    const everyRow = [
      siteRow(site),
      chargerRow(charger),
      profileRow(profile),
      vehicleRow(vehicle),
      sessionRow(session),
      reportRow(report),
    ];
    for (const row of everyRow) {
      for (const key of Object.keys(row)) {
        expect(key, `"${key}" is not snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });
});
