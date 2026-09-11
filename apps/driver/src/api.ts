/**
 * API client. Until Supabase auth is wired in, the driver is identified by the dev headers the
 * server accepts; `EXPO_PUBLIC_DRIVER_ID` picks which seeded driver the app signs in as.
 * A phone needs the machine's LAN address here, not localhost.
 */

export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8085';
export const SITE_ID = process.env.EXPO_PUBLIC_SITE_ID ?? 'site-riverside';

export type ChargingMode = 'cheapest' | 'greenest' | 'fastest' | 'balanced';

export interface Session {
  id: string;
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

export interface Vehicle {
  id: string;
  label: string;
  batteryKwh: number;
  maxChargeKw: number;
}

export interface Charger {
  id: string;
  label: string;
  maxPowerKw: number;
  online: boolean;
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

let driverId = process.env.EXPO_PUBLIC_DRIVER_ID ?? 'drv-amara';

export const setDriverId = (id: string): void => {
  driverId = id;
};
export const getDriverId = (): string => driverId;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'x-dev-role': 'driver', 'x-dev-user': driverId };
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
  const clock = await request<{ nowMs: number; scale: number }>('/clock');
  anchorServerMs = clock.nowMs;
  anchorRealMs = Date.now();
  timeScale = clock.scale;
}

export const api = {
  clock: () => request<{ nowMs: number; scale: number }>('/clock'),
  me: () => request<{ id: string; displayName: string; defaultMode: ChargingMode }>('/me'),
  forecast: () => request<Forecast>(`/sites/${SITE_ID}/forecast?hours=24`),
  chargers: () => request<Charger[]>(`/sites/${SITE_ID}/chargers`),
  vehicles: () => request<Vehicle[]>('/vehicles'),
  current: () => request<CurrentSession | null>('/sessions/current'),
  history: () => request<(Session & { report: Report | null })[]>('/sessions?limit=20'),
  report: (sessionId: string) => request<Report>(`/sessions/${sessionId}/report`),
  preview: (input: { energyKwh: number; deadlineAt: string; maxPowerKw: number }) =>
    request<Preview>('/sessions/preview', { method: 'POST', body: JSON.stringify({ siteId: SITE_ID, ...input }) }),
  createSession: (input: {
    chargerId: string;
    vehicleId?: string;
    energyKwh: number;
    deadlineAt: string;
    mode: ChargingMode;
  }) => request<Session>('/sessions', { method: 'POST', body: JSON.stringify(input) }),
  updateSession: (id: string, patch: { deadlineAt?: string; mode?: ChargingMode; energyKwh?: number }) =>
    request<Session>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  stopSession: (id: string) => request<{ status: string }>(`/sessions/${id}/stop`, { method: 'POST' }),
};
