/**
 * A self-contained snapshot, used only when no server answers.
 *
 * A jury should be able to open the app on a plane and see every screen work. What they must not
 * see is invented data wearing the clothes of a measurement, so anything served from here is
 * labelled in the interface as demo data for as long as it is in use.
 *
 * The numbers are generated from the clock rather than frozen: the session fills, the ring moves,
 * and the grid curve sits where it would at this hour. The shapes match the server's own synthetic
 * profiles, so the offline demo and the live system tell the same story.
 */

import type {
  Charger,
  ChargingMode,
  CurrentSession,
  Forecast,
  ModePreview,
  Preview,
  Report,
  Session,
  SiteSummary,
  Vehicle,
} from './api';

const HOUR = 3_600_000;
const SLOT_MINUTES = 15;

export const DEMO_SITES: SiteSummary[] = [
  {
    id: 'site-gandhinagar-secretariat',
    name: 'Gandhinagar Secretariat Car Park',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    country: 'IN',
    regionCode: 'GJ',
    gridConnectionKw: 120,
  },
  {
    id: 'site-ahmedabad-ashram-road',
    name: 'Ahmedabad Ashram Road Plaza',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    country: 'IN',
    regionCode: 'GJ',
    gridConnectionKw: 200,
  },
  {
    id: 'site-vadodara-alkapuri-depot',
    name: 'Vadodara Alkapuri Depot',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    country: 'IN',
    regionCode: 'GJ',
    gridConnectionKw: 150,
  },
  {
    id: 'site-surat-textile-park',
    name: 'Surat Textile Park Yard',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    country: 'IN',
    regionCode: 'GJ',
    gridConnectionKw: 180,
  },
  {
    id: 'site-riverside',
    name: 'Riverside Office Car Park',
    timezone: 'Europe/London',
    currency: 'GBP',
    country: 'GB',
    regionCode: 'C',
    gridConnectionKw: 65,
  },
];

export const DEMO_VEHICLE: Vehicle = {
  id: 'veh-harsh',
  label: 'Tata Nexon EV 45',
  batteryKwh: 45,
  maxChargeKw: 7.2,
};

/** Every rate below is the car's, so changing the car above changes them all together. */
const RATE_KW = DEMO_VEHICLE.maxChargeKw;

/** Grid shapes per country, matching apps/server/src/forecast/synthetic.ts. */
const CURVES: Record<string, { carbon: [number, number][]; price: [number, number][]; renewable: [number, number][] }> = {
  GB: {
    carbon: [
      [0, 230],
      [3, 195],
      [6, 300],
      [9, 420],
      [12, 190],
      [15, 210],
      [18, 690],
      [21, 420],
    ],
    price: [
      [0, 0.09],
      [3, 0.08],
      [6, 0.14],
      [9, 0.22],
      [12, 0.16],
      [15, 0.18],
      [18, 0.42],
      [21, 0.24],
    ],
    renewable: [
      [0, 0.46],
      [3, 0.52],
      [6, 0.38],
      [9, 0.3],
      [12, 0.72],
      [15, 0.66],
      [18, 0.18],
      [21, 0.36],
    ],
  },
  IN: {
    carbon: [
      [0, 715],
      [3, 700],
      [6, 675],
      [9, 590],
      [12, 470],
      [15, 515],
      [18, 790],
      [21, 760],
    ],
    price: [
      [0, 7],
      [3, 6.5],
      [6, 8],
      [9, 9.2],
      [12, 7.6],
      [15, 8.1],
      [18, 12.4],
      [21, 10.2],
    ],
    renewable: [
      [0, 0.22],
      [3, 0.25],
      [6, 0.2],
      [9, 0.35],
      [12, 0.54],
      [15, 0.45],
      [18, 0.11],
      [21, 0.15],
    ],
  },
  'IN-GJ': {
    carbon: [
      [0, 655],
      [3, 635],
      [6, 605],
      [9, 470],
      [12, 330],
      [15, 405],
      [18, 725],
      [21, 700],
    ],
    price: [
      [0, 4.2],
      [3, 4.2],
      [6, 4.9],
      [9, 6.7],
      [12, 5.2],
      [15, 5.2],
      [18, 6.7],
      [21, 6.2],
    ],
    renewable: [
      [0, 0.18],
      [3, 0.2],
      [6, 0.23],
      [9, 0.43],
      [12, 0.62],
      [15, 0.5],
      [18, 0.13],
      [21, 0.16],
    ],
  },
};

/** Most specific first, the same order the server resolves a grid profile in. */
function curvesFor(site: SiteSummary): { carbon: [number, number][]; price: [number, number][]; renewable: [number, number][] } {
  return CURVES[`${site.country}-${site.regionCode}`] ?? CURVES[site.country] ?? (CURVES.GB as NonNullable<(typeof CURVES)[string]>);
}

function interpolate(curve: [number, number][], hour: number): number {
  const wrapped = ((hour % 24) + 24) % 24;
  for (let index = 0; index < curve.length; index += 1) {
    const current = curve[index] as [number, number];
    const next = (curve[index + 1] ?? [curve[0]![0] + 24, curve[0]![1]]) as [number, number];
    if (wrapped >= current[0] && wrapped < next[0]) {
      const ratio = (wrapped - current[0]) / (next[0] - current[0]);
      return current[1] + (next[1] - current[1]) * ratio;
    }
  }
  const last = curve[curve.length - 1] as [number, number];
  const first = curve[0] as [number, number];
  const span = first[0] + 24 - last[0];
  const ratio = span <= 0 ? 0 : (wrapped - last[0] + (wrapped < last[0] ? 24 : 0)) / span;
  return last[1] + (first[1] - last[1]) * ratio;
}

function localHour(ms: number, timezone: string): number {
  const text = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(
    new Date(ms),
  );
  return Number(text);
}

export function demoForecast(site: SiteSummary, nowMs: number): Forecast {
  const curves = curvesFor(site);
  const slots = 96;
  const startMs = Math.floor(nowMs / (SLOT_MINUTES * 60_000)) * (SLOT_MINUTES * 60_000);
  const hourAt = (slot: number): number => localHour(startMs + slot * SLOT_MINUTES * 60_000, site.timezone) + (slot % 4) / 4;

  const carbonGPerKwh = Array.from({ length: slots }, (_, slot) => interpolate(curves.carbon, hourAt(slot)));
  const pricePerKwh = Array.from({ length: slots }, (_, slot) => interpolate(curves.price, hourAt(slot)));
  const renewableShare = Array.from({ length: slots }, (_, slot) => interpolate(curves.renewable, hourAt(slot)));

  // The cleanest three-hour run inside the window, which is what the scheduler would aim at.
  const runSlots = 12;
  let bestStart = 0;
  let bestCarbon = Number.POSITIVE_INFINITY;
  for (let start = 0; start + runSlots <= slots; start += 1) {
    let total = 0;
    for (let offset = 0; offset < runSlots; offset += 1) total += carbonGPerKwh[start + offset] ?? 0;
    if (total < bestCarbon) {
      bestCarbon = total;
      bestStart = start;
    }
  }
  let shareTotal = 0;
  for (let offset = 0; offset < runSlots; offset += 1) shareTotal += renewableShare[bestStart + offset] ?? 0;

  return {
    startMs,
    stepMinutes: SLOT_MINUTES,
    carbonGPerKwh,
    pricePerKwh,
    renewableShare,
    greenWindow: {
      startMs: startMs + bestStart * SLOT_MINUTES * 60_000,
      endMs: startMs + (bestStart + runSlots) * SLOT_MINUTES * 60_000,
      avgCarbonGPerKwh: bestCarbon / runSlots,
      avgRenewableShare: shareTotal / runSlots,
    },
  };
}

/** Bay count, power and id prefix per site, matching the scenario files the server seeds from. */
const DEMO_BAYS: Record<string, { prefix: string; count: number; maxPowerKw: number }> = {
  'site-gandhinagar-secretariat': { prefix: 'GN', count: 8, maxPowerKw: 22 },
  'site-ahmedabad-ashram-road': { prefix: 'AF', count: 4, maxPowerKw: 60 },
  'site-vadodara-alkapuri-depot': { prefix: 'VD', count: 6, maxPowerKw: 30 },
  'site-surat-textile-park': { prefix: 'SR', count: 6, maxPowerKw: 22 },
  'site-riverside': { prefix: 'CP', count: 8, maxPowerKw: 22 },
};

const baysFor = (siteId: string) => DEMO_BAYS[siteId] ?? { prefix: 'CP', count: 8, maxPowerKw: 22 };

/** The bay the demo session is plugged into: the first one at whichever site is selected. */
export function demoChargerId(siteId: string): string {
  const bays = baysFor(siteId);
  return `${bays.prefix}-01`;
}

export function demoChargers(siteId: string): Charger[] {
  const { prefix, count, maxPowerKw } = baysFor(siteId);
  const busy = new Set([1, 3, 4, 7]);
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const taken = busy.has(number);
    return {
      id: `${prefix}-${String(number).padStart(2, '0')}`,
      label: `Bay ${number}`,
      maxPowerKw,
      online: true,
      connectors: [
        {
          connectorId: 1,
          status: taken ? 'Charging' : 'Available',
          sessionId: taken ? `demo-${number}` : null,
        },
      ],
    };
  });
}

/** The session grows with the clock, so the ring moves while the demo is open. */
export function demoCurrent(site: SiteSummary, nowMs: number): CurrentSession {
  const pluggedInMs = nowMs - 2.5 * HOUR;
  const deadlineMs = pluggedInMs + 11 * HOUR;
  const energyNeededKwh = 30;
  const forecast = demoForecast(site, nowMs);
  const carbonNow = forecast.carbonGPerKwh[0] ?? 250;

  // Charging when the grid is in the cleaner half of its own day, holding when it is not: the
  // behaviour the optimiser would produce, driven off the same curve. The comparison has to be
  // against this grid's own range, not a fixed number of grams — 380 g is a dirty hour in Britain
  // and a clean one in Gujarat, and a fixed threshold would have the demo hold all day there.
  const sorted = [...forecast.carbonGPerKwh].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? carbonNow;
  const dirty = carbonNow > median;
  const elapsedHours = (nowMs - pluggedInMs) / HOUR;
  // Averaged over the stay rather than the rate while charging, since it holds for some of it.
  const delivered = Math.min(energyNeededKwh, Math.max(0, elapsedHours - 0.5) * RATE_KW * 0.66);

  const slotMs = SLOT_MINUTES * 60_000;
  const gridStartMs = Math.floor(nowMs / slotMs) * slotMs;
  const remaining = Math.max(0, energyNeededKwh - delivered);
  const plannedKw: number[] = Array.from({ length: 96 }, () => 0);
  let left = remaining;
  // Fill the cleanest slots first, which is what "greenest" means.
  const order = plannedKw
    .map((_, slot) => ({ slot, carbon: forecast.carbonGPerKwh[slot] ?? 999 }))
    .sort((a, b) => a.carbon - b.carbon);
  for (const entry of order) {
    if (left <= 0) break;
    const take = Math.min(RATE_KW, left / (SLOT_MINUTES / 60));
    plannedKw[entry.slot] = Math.round(take * 100) / 100;
    left -= take * (SLOT_MINUTES / 60);
  }

  return {
    session: {
      id: 'demo-session',
      siteId: site.id,
      chargerId: demoChargerId(site.id),
      status: 'active',
      mode: 'greenest',
      pluggedInMs,
      deadlineMs,
      energyNeededKwh,
      energyDeliveredKwh: Math.round(delivered * 100) / 100,
      currentPowerKw: dirty || delivered >= energyNeededKwh ? 0 : RATE_KW,
      limitKw: dirty ? 0 : RATE_KW,
      maxPowerKw: RATE_KW,
      deadlineRisk: false,
    },
    remainingKwh: Math.round(remaining * 100) / 100,
    socPercent: Math.min(0.98, 0.22 + delivered / DEMO_VEHICLE.batteryKwh),
    plannedKw,
    planGrid: { startMs: gridStartMs, slotMinutes: SLOT_MINUTES, slots: 96 },
  };
}

const MODE_SHAPE: Record<ChargingMode, { cost: number; co2: number; share: number; hours: number }> = {
  cheapest: { cost: 0.86, co2: 1.04, share: 0.94, hours: 7.5 },
  greenest: { cost: 1.02, co2: 0.82, share: 1.12, hours: 7.5 },
  fastest: { cost: 1.38, co2: 1.35, share: 0.86, hours: 3.5 },
  balanced: { cost: 0.9, co2: 0.9, share: 1.04, hours: 7 },
};

export function demoPreview(site: SiteSummary, energyKwh: number, deadlineMs: number, nowMs: number): Preview {
  const forecast = demoForecast(site, nowMs);
  const meanPrice = forecast.pricePerKwh.reduce((total, value) => total + value, 0) / forecast.pricePerKwh.length;
  const meanCarbon = forecast.carbonGPerKwh.reduce((total, value) => total + value, 0) / forecast.carbonGPerKwh.length;
  const meanShare = forecast.renewableShare.reduce((total, value) => total + value, 0) / forecast.renewableShare.length;

  const modes: ModePreview[] = (Object.keys(MODE_SHAPE) as ChargingMode[]).map((mode) => {
    const shape = MODE_SHAPE[mode];
    return {
      mode,
      cost: Math.round(energyKwh * meanPrice * shape.cost * 100) / 100,
      co2Kg: Math.round(((energyKwh * meanCarbon * shape.co2) / 1000) * 100) / 100,
      energyKwh,
      renewableShare: Math.min(0.95, meanShare * shape.share),
      finishByMs: Math.min(deadlineMs, nowMs + shape.hours * HOUR),
      shortfallKwh: 0,
    };
  });

  return {
    feasible: true,
    earliestDeadlineAt: new Date(nowMs + (energyKwh / RATE_KW) * HOUR).toISOString(),
    maxDeliverableKwh: Math.round(((deadlineMs - nowMs) / HOUR) * RATE_KW),
    modes,
  };
}

export function demoHistory(site: SiteSummary, nowMs: number): (Session & { report: Report | null })[] {
  const rows: { days: number; energy: number; mode: ChargingMode; score: number; avoided: number; saved: number }[] = [
    { days: 1, energy: 28.4, mode: 'greenest', score: 88, avoided: 3.2, saved: site.currency === 'INR' ? 41 : 1.9 },
    { days: 2, energy: 19.6, mode: 'balanced', score: 74, avoided: 1.9, saved: site.currency === 'INR' ? 27 : 1.2 },
    { days: 4, energy: 31.2, mode: 'cheapest', score: 61, avoided: 1.4, saved: site.currency === 'INR' ? 52 : 2.4 },
    { days: 6, energy: 24.0, mode: 'greenest', score: 91, avoided: 3.6, saved: site.currency === 'INR' ? 38 : 1.7 },
  ];

  return rows.map((row, index) => {
    const pluggedInMs = nowMs - row.days * 24 * HOUR;
    return {
      id: `demo-past-${index}`,
      siteId: site.id,
      chargerId: demoChargerId(site.id),
      status: 'complete',
      mode: row.mode,
      pluggedInMs,
      deadlineMs: pluggedInMs + 10 * HOUR,
      energyNeededKwh: row.energy,
      energyDeliveredKwh: row.energy,
      currentPowerKw: 0,
      limitKw: null,
      maxPowerKw: RATE_KW,
      deadlineRisk: false,
      report: {
        sessionId: `demo-past-${index}`,
        energyKwh: row.energy,
        cost: Math.round(row.energy * (site.currency === 'INR' ? 7.4 : 0.21) * 100) / 100,
        co2Kg: Math.round(row.energy * (site.country === 'IN' ? 0.62 : 0.1) * 100) / 100,
        renewableShare: 0.4 + (row.score / 100) * 0.4,
        avoidedCo2Kg: row.avoided,
        costSaved: row.saved,
        greenScore: row.score,
        verified: true,
      },
    };
  });
}
