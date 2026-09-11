/**
 * Shapes the dashboard reads from the API. Deliberately a local copy rather than an import from
 * @cleangrid/shared: the dashboard is a separate deployable and should not pull the server's
 * TypeScript sources through its bundler.
 */

export type ChargingMode = 'cheapest' | 'greenest' | 'fastest' | 'balanced';
export type SessionStatus = 'pending' | 'active' | 'complete' | 'aborted';

export interface Overview {
  siteId: string;
  nowMs: number;
  currency: string;
  gridConnectionKw: number;
  siteDemandKw: number;
  chargingKw: number;
  baseLoadKw: number;
  headroomKw: number;
  carsCharging: number;
  carsPluggedIn: number;
  carsAtRisk: number;
  chargersOnline: number;
  chargersTotal: number;
  carbonGPerKwh: number;
  renewableShare: number;
  pricePerKwh: number;
  peakSoFarKw: number;
  plannedPeakKw: number | null;
  plannedCost: number | null;
  plannedCo2Kg: number | null;
  plannedEnergyKwh: number | null;
  lastPlanMs: number | null;
  solver: string | null;
  planStatus: string | null;
}

export interface PlanGrid {
  startMs: number;
  nowMs: number;
  slotMinutes: number;
  slots: number;
}

export interface Plan {
  id: string;
  siteId: string;
  solvedMs: number;
  trigger: string;
  grid: PlanGrid;
  solver: string;
  status: string;
  fallbackReason: string | null;
  solveMs: number;
  totals: { energyKwh: number; cost: number; co2Kg: number; peakKw: number; objective: number };
  shortfalls: { sessionId: string; shortfallKwh: number }[];
  allocationsKw: Record<string, number[]>;
  siteLoadKw: number[];
  baseLoadKw: number[];
  capKw: number[];
  carbonGPerKwh: number[];
  pricePerKwh: number[];
  renewableShare: number[];
}

export interface Session {
  id: string;
  siteId: string;
  chargerId: string;
  connectorId: number;
  driverId: string | null;
  driverName?: string | null;
  idTag: string;
  transactionId: number | null;
  source: 'app' | 'rfid' | 'remote';
  status: SessionStatus;
  mode: ChargingMode;
  pluggedInMs: number;
  deadlineMs: number;
  unpluggedMs: number | null;
  energyNeededKwh: number;
  energyDeliveredKwh: number;
  remainingKwh?: number;
  maxPowerKw: number;
  currentPowerKw: number;
  limitKw: number | null;
  deadlineRisk: boolean;
}

export interface Connector {
  chargerId: string;
  connectorId: number;
  status: string;
  errorCode: string;
  sessionId: string | null;
}

export interface Charger {
  id: string;
  siteId: string;
  ocppIdentity: string;
  label: string;
  maxPowerKw: number;
  minPowerKw: number;
  online: boolean;
  uncontrolled: boolean;
  vendor: string | null;
  model: string | null;
  connectors: Connector[];
}

export interface Forecast {
  startMs: number;
  stepMinutes: number;
  carbonGPerKwh: number[];
  pricePerKwh: number[];
  renewableShare: number[];
  sources: { carbon: string; price: string; renewable: string };
  notes: string[];
  greenWindow: { startMs: number; endMs: number; avgCarbonGPerKwh: number; avgRenewableShare: number } | null;
}

export interface FlexEvent {
  id: string;
  siteId: string;
  startsMs: number;
  endsMs: number;
  capKw: number;
  reason: string | null;
  status: 'requested' | 'accepted' | 'declined' | 'active' | 'completed' | 'cancelled';
  createdMs: number;
}

export interface Dispatch {
  id: string;
  chargerId: string;
  sessionId: string;
  sentMs: number;
  limitW: number;
  status: string;
  error: string | null;
}

export interface Impact {
  sessions: number;
  verifiedSessions: number;
  energyKwh: number;
  cost: number;
  co2Kg: number;
  baselineCost: number;
  baselineCo2Kg: number;
  avoidedCo2Kg: number;
  costSaved: number;
  avgGreenScore: number;
  avgRenewableShare: number;
  peakKw: number;
  currency: string;
}

export type SiteEvent =
  | { type: 'session.updated'; session: Session }
  | { type: 'charger.updated'; charger: Charger; connectors: Connector[] }
  | { type: 'meter.updated'; sessionId: string; chargerId: string; powerKw: number; energyKwh: number; tsMs: number }
  | { type: 'plan.solved'; plan: Plan }
  | { type: 'forecast.updated'; forecast: unknown }
  | { type: 'dispatch.sent'; dispatch: Dispatch }
  | { type: 'flex.updated'; flex: FlexEvent }
  | { type: 'report.ready'; report: { sessionId: string } }
  | { type: 'clock.tick'; nowMs: number; scale: number };
