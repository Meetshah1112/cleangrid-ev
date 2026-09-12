import {
  DEMO_SITES,
  DEMO_VEHICLE,
  demoChargers,
  demoCurrent,
  demoForecast,
  demoHistory,
  demoPreview,
} from './demo';

/**
 * API client. Until Supabase auth is wired in, the driver is identified by the dev headers the
 * server accepts; `EXPO_PUBLIC_DRIVER_ID` picks which seeded driver the app signs in as.
 * A phone needs the machine's LAN address here, not localhost.
 */

/**
 * Where the server is.
 *
 * A phone reaches this machine one of two ways, and which one is true changes without warning: over
 * Wi-Fi at its LAN address, or over the USB cable once `adb reverse tcp:8095 tcp:8095` maps the
 * phone's own localhost back here. Rather than bake in a guess and fail when the phone drops to
 * mobile data, the app asks each candidate for /health on first use and keeps whichever answers.
 */
const CANDIDATES: string[] = [
  process.env.EXPO_PUBLIC_API_URL,
  'http://127.0.0.1:8095',
  'http://10.0.2.2:8095', // the host machine, as seen from an Android emulator
].filter((value): value is string => typeof value === 'string' && value.length > 0);

const PROBE_TIMEOUT_MS = 2_500;

let resolvedBase: string | null = null;
let probe: Promise<string> | null = null;
let offline = false;

/** True when no server answered and the app is running on the built-in snapshot. */
export const isOffline = (): boolean => offline;

export const getApiBase = (): string => resolvedBase ?? (CANDIDATES[0] as string);

async function reachable(candidate: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch(`${candidate}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveBase(): Promise<string> {
  if (resolvedBase !== null) return resolvedBase;
  if (probe === null) {
    probe = (async () => {
      for (const candidate of CANDIDATES) {
        if (await reachable(candidate)) {
          resolvedBase = candidate;
          offline = false;
          return candidate;
        }
      }
      offline = true;
      // Nothing answered. Forget the attempt so the next request probes again, and report against
      // the configured address, which is the one worth naming in an error.
      probe = null;
      return CANDIDATES[0] as string;
    })();
  }
  return probe;
}

/** Which site the driver is at. Changeable in Profile, because a fleet has more than one. */
let siteId = process.env.EXPO_PUBLIC_SITE_ID ?? 'site-gandhinagar-secretariat';
export const getSiteId = (): string => siteId;
export const setSiteId = (next: string): void => {
  siteId = next;
};

export type ChargingMode = 'cheapest' | 'greenest' | 'fastest' | 'balanced';

export interface Session {
  id: string;
  siteId: string;
  chargerId: string;
  status: 'pending' | 'active' | 'complete' | 'aborted';
  mode: ChargingMode;
  pluggedInMs: number;
  deadlineMs: number;
  energyNeededKwh: number;
  energyDeliveredKwh: number;
  currentPowerKw: number;
  limitKw: number | null;
  maxPowerKw: number;
  deadlineRisk: boolean;
}

export interface CurrentSession {
  session: Session;
  remainingKwh: number;
  /** Reported by the car through the charger; null when the charger sends no SoC. */
  socPercent?: number | null;
  plannedKw: number[] | null;
  planGrid: { startMs: number; slotMinutes: number; slots: number } | null;
}

export interface Forecast {
  startMs: number;
  stepMinutes: number;
  carbonGPerKwh: number[];
  renewableShare: number[];
  pricePerKwh: number[];
  greenWindow: { startMs: number; endMs: number; avgCarbonGPerKwh: number; avgRenewableShare: number } | null;
}

export interface ModePreview {
  mode: ChargingMode;
  cost: number;
  co2Kg: number;
  energyKwh: number;
  renewableShare: number;
  finishByMs: number | null;
  shortfallKwh: number;
}

export interface Preview {
  feasible: boolean;
  earliestDeadlineAt: string;
  maxDeliverableKwh: number;
  modes: ModePreview[];
}

export interface Report {
  sessionId: string;
  energyKwh: number;
  cost: number;
  co2Kg: number;
  renewableShare: number;
  avoidedCo2Kg: number;
  costSaved: number;
  greenScore: number;
  verified: boolean;
  provisional?: boolean;
}

export interface SiteSummary {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  country: string;
  /** State or grid region. Gujarat and Karnataka are one country and two very different grids. */
  regionCode: string;
  gridConnectionKw: number;
}

export interface Vehicle {
  id: string;
  label: string;
  batteryKwh: number;
  maxChargeKw: number;
}

export interface Connector {
  connectorId: number;
  status: string;
  sessionId: string | null;
}

export interface Charger {
  id: string;
  label: string;
  maxPowerKw: number;
  online: boolean;
  connectors?: Connector[];
}

/** Statuses that mean a driver can plug in here right now. */
const FREE_STATUSES = ['Available', 'Preparing'];

export function bayIsFree(charger: Charger): boolean {
  if (!charger.online) return false;
  const connectors = charger.connectors ?? [];
  if (connectors.length === 0) return true;
  return connectors.some((connector) => connector.sessionId === null && FREE_STATUSES.includes(connector.status));
}

export class ApiError extends Error {
  readonly code: string;
  readonly details: { earliestDeadlineAt?: string; maxDeliverableKwh?: number } | undefined;

  constructor(code: string, message: string, details?: { earliestDeadlineAt?: string; maxDeliverableKwh?: number }) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

let driverId = process.env.EXPO_PUBLIC_DRIVER_ID ?? 'drv-harsh';

export const setDriverId = (id: string): void => {
  driverId = id;
};
export const getDriverId = (): string => driverId;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'x-dev-role': 'driver', 'x-dev-user': driverId };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${await resolveBase()}${path}`, { ...init, headers });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: T;
    error?: { code?: string; message?: string; details?: { earliestDeadlineAt?: string; maxDeliverableKwh?: number } };
  };
  if (!response.ok || body.ok !== true) {
    throw new ApiError(
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `HTTP ${response.status}`,
      body.error?.details,
    );
  }
  return body.data as T;
}

/**
 * The server may be running on a simulated clock during a demo, so the app works in server time
 * rather than phone time. Anchored like the server's own clock and re-synced periodically.
 */
let anchorServerMs = Date.now();
let anchorRealMs = Date.now();
let timeScale = 1;

export const serverNow = (): number => anchorServerMs + (Date.now() - anchorRealMs) * timeScale;

export async function syncClock(): Promise<void> {
  const clock = await api.clock();
  anchorServerMs = clock.nowMs;
  anchorRealMs = Date.now();
  timeScale = clock.scale;
}

/**
 * Demo fallback.
 *
 * Only ever used when no server answered the initial probe: if one was reachable and later drops,
 * errors surface instead, because quietly replacing measured numbers with invented ones is the one
 * thing this app must not do. Anything served from here is labelled in the interface.
 */
const demoState: { stopped: boolean; mode: ChargingMode | null } = { stopped: false, mode: null };

const demoSite = (): SiteSummary => DEMO_SITES.find((site) => site.id === siteId) ?? (DEMO_SITES[0] as SiteSummary);

async function orDemo<T>(run: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (offline) return fallback();
    throw error;
  }
}

function demoCurrentSession(): CurrentSession | null {
  if (demoState.stopped) return null;
  const current = demoCurrent(demoSite(), Date.now());
  if (demoState.mode === null) return current;
  return { ...current, session: { ...current.session, mode: demoState.mode } };
}

export const api = {
  clock: () => orDemo(() => request<{ nowMs: number; scale: number }>('/clock'), () => ({ nowMs: Date.now(), scale: 1 })),
  me: () =>
    orDemo(
      () => request<{ id: string; displayName: string; defaultMode: ChargingMode }>('/me'),
      () => ({ id: driverId, displayName: 'Amara Okafor', defaultMode: (demoState.mode ?? 'greenest') as ChargingMode }),
    ),
  updateMe: (patch: { defaultMode?: ChargingMode }) =>
    orDemo(
      () =>
        request<{ id: string; displayName: string; defaultMode: ChargingMode }>('/me', {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),
      () => {
        if (patch.defaultMode) demoState.mode = patch.defaultMode;
        return { id: driverId, displayName: 'Amara Okafor', defaultMode: demoState.mode ?? 'greenest' };
      },
    ),
  sites: () => orDemo(() => request<SiteSummary[]>('/sites'), () => DEMO_SITES),
  forecast: () =>
    orDemo(() => request<Forecast>(`/sites/${siteId}/forecast?hours=24`), () => demoForecast(demoSite(), Date.now())),
  chargers: () => orDemo(() => request<Charger[]>(`/sites/${siteId}/chargers`), () => demoChargers(siteId)),
  vehicles: () => orDemo(() => request<Vehicle[]>('/vehicles'), () => [DEMO_VEHICLE]),
  current: () => orDemo(() => request<CurrentSession | null>('/sessions/current'), demoCurrentSession),
  history: () =>
    orDemo(
      () => request<(Session & { report: Report | null })[]>('/sessions?limit=20'),
      () => demoHistory(demoSite(), Date.now()),
    ),
  report: (sessionId: string) =>
    orDemo(
      () => request<Report>(`/sessions/${sessionId}/report`),
      () => demoHistory(demoSite(), Date.now())[0]?.report as Report,
    ),
  preview: (input: { energyKwh: number; deadlineAt: string; maxPowerKw: number }) =>
    orDemo(
      () => request<Preview>('/sessions/preview', { method: 'POST', body: JSON.stringify({ siteId, ...input }) }),
      () => demoPreview(demoSite(), input.energyKwh, Date.parse(input.deadlineAt), Date.now()),
    ),
  createSession: (input: {
    chargerId: string;
    vehicleId?: string;
    energyKwh: number;
    deadlineAt: string;
    mode: ChargingMode;
  }) =>
    orDemo(
      () => request<Session>('/sessions', { method: 'POST', body: JSON.stringify(input) }),
      () => {
        demoState.stopped = false;
        demoState.mode = input.mode;
        return (demoCurrentSession() as CurrentSession).session;
      },
    ),
  updateSession: (id: string, patch: { deadlineAt?: string; mode?: ChargingMode; energyKwh?: number }) =>
    orDemo(
      () => request<Session>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
      () => {
        if (patch.mode) demoState.mode = patch.mode;
        return (demoCurrentSession() as CurrentSession).session;
      },
    ),
  stopSession: (id: string) =>
    orDemo(
      () => request<{ status: string }>(`/sessions/${id}/stop`, { method: 'POST' }),
      () => {
        demoState.stopped = true;
        return { status: 'complete' };
      },
    ),
};
