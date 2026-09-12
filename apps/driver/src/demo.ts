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
    id: 'site-riverside',
    name: 'Riverside Office Car Park',
    timezone: 'Europe/London',
    currency: 'GBP',
    country: 'GB',
    gridConnectionKw: 65,
  },
  {
    id: 'site-koramangala',
    name: 'Koramangala Fleet Hub',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    country: 'IN',
    gridConnectionKw: 250,
  },
];

export const DEMO_VEHICLE: Vehicle = {
  id: 'veh-amara',
  label: 'Nissan Leaf 40',
  batteryKwh: 40,
  maxChargeKw: 6.6,
};

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
};

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
  const curves = CURVES[site.country] ?? CURVES.GB!;
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

export function demoChargers(siteId: string): Charger[] {
  const count = siteId === 'site-koramangala' ? 7 : 10;
  const maxPowerKw = siteId === 'site-koramangala' ? 60 : 22;
  const busy = new Set([1, 3, 4, 7]);
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    const taken = busy.has(number);
    return {
      id: `CP-${String(number).padStart(2, '0')}`,
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

  // Charging when the grid is in the cleaner half of its day, holding when it is not: the
  // behaviour the optimiser would produce, driven off the same curve.
  const dirty = carbonNow > 380;
  const elapsedHours = (nowMs - pluggedInMs) / HOUR;
  const delivered = Math.min(energyNeededKwh, Math.max(0, elapsedHours - 0.5) * 4.4);

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
    const take = Math.min(6.6, left / (SLOT_MINUTES / 60));
    plannedKw[entry.slot] = Math.round(take * 100) / 100;
    left -= take * (SLOT_MINUTES / 60);
  }

  return {
    session: {
      id: 'demo-session',
      siteId: site.id,
      chargerId: 'CP-05',
      status: 'active',
      mode: 'greenest',
      pluggedInMs,
      deadlineMs,
      energyNeededKwh,
      energyDeliveredKwh: Math.round(delivered * 100) / 100,
      currentPowerKw: dirty || delivered >= energyNeededKwh ? 0 : 6.6,
      limitKw: dirty ? 0 : 6.6,
      maxPowerKw: 6.6,
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
    earliestDeadlineAt: new Date(nowMs + (energyKwh / 6.6) * HOUR).toISOString(),
    maxDeliverableKwh: Math.round(((deadlineMs - nowMs) / HOUR) * 6.6),
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
      chargerId: `CP-0${(index % 8) + 1}`,
      status: 'complete',
      mode: row.mode,
      pluggedInMs,
      deadlineMs: pluggedInMs + 10 * HOUR,
      energyNeededKwh: row.energy,
      energyDeliveredKwh: row.energy,
      currentPowerKw: 0,
      limitKw: null,
      maxPowerKw: 6.6,
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
