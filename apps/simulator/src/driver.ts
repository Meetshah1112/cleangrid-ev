import type { ChargingMode } from './deps';

/**
 * The driver-app half of an arrival. Before the cable goes in, the app tells the server what the
 * driver needs and by when. If the deadline cannot be met it is told so, with the earliest time
 * that can, and it settles for what fits rather than silently missing the deadline.
 */

export interface IntentRequest {
  readonly driverId: string;
  readonly chargerId: string;
  readonly connectorId: number;
  readonly vehicleId: string;
  readonly energyKwh: number;
  readonly deadlineMs: number;
  readonly departMs: number;
  readonly mode: ChargingMode;
}

export interface IntentResult {
  readonly outcome: 'accepted' | 'adjusted' | 'failed';
  readonly sessionId: string | null;
  readonly energyKwh: number;
  readonly deadlineMs: number;
  readonly message: string;
}

interface ApiReply {
  readonly status: number;
  readonly body: {
    ok?: boolean;
    data?: { id?: string };
    error?: { code?: string; message?: string; details?: { earliestDeadlineAt?: string; maxDeliverableKwh?: number } };
  };
}

async function post(apiUrl: string, driverId: string, body: unknown): Promise<ApiReply> {
  const response = await fetch(`${apiUrl.replace(/\/$/, '')}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dev-role': 'driver', 'x-dev-user': driverId },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json().catch(() => ({}))) as ApiReply['body'];
  return { status: response.status, body: parsed };
}

export async function declareIntent(apiUrl: string, request: IntentRequest): Promise<IntentResult> {
  const payload = {
    chargerId: request.chargerId,
    connectorId: request.connectorId,
    vehicleId: request.vehicleId,
    energyKwh: request.energyKwh,
    deadlineAt: new Date(request.deadlineMs).toISOString(),
    mode: request.mode,
  };

  const first = await post(apiUrl, request.driverId, payload);
  if (first.status < 300) {
    return {
      outcome: 'accepted',
      sessionId: first.body.data?.id ?? null,
      energyKwh: request.energyKwh,
      deadlineMs: request.deadlineMs,
      message: 'accepted',
    };
  }

  if (first.status === 422 && first.body.error?.code === 'deadline_unreachable') {
    const details = first.body.error.details ?? {};
    const earliestMs = details.earliestDeadlineAt ? Date.parse(details.earliestDeadlineAt) : Number.NaN;
    const canWait = Number.isFinite(earliestMs) && earliestMs <= request.departMs;
    // Shave a little off the maximum: the clock moves between the refusal and the retry, and
    // asking for exactly what fitted a second ago gets refused again.
    const fits = Math.max(1, Math.floor((details.maxDeliverableKwh ?? 1) * 0.95 * 10) / 10);
    const retry = canWait ? { ...payload, deadlineAt: new Date(earliestMs).toISOString() } : { ...payload, energyKwh: fits };

    const second = await post(apiUrl, request.driverId, retry);
    if (second.status < 300) {
      return {
        outcome: 'adjusted',
        sessionId: second.body.data?.id ?? null,
        energyKwh: retry.energyKwh,
        deadlineMs: Date.parse(retry.deadlineAt),
        message: canWait
          ? `deadline moved to the earliest the charger can reach`
          : `need cut to ${retry.energyKwh} kWh, the most that fits before leaving`,
      };
    }
    return {
      outcome: 'failed',
      sessionId: null,
      energyKwh: request.energyKwh,
      deadlineMs: request.deadlineMs,
      message: second.body.error?.message ?? `HTTP ${second.status}`,
    };
  }

  return {
    outcome: 'failed',
    sessionId: null,
    energyKwh: request.energyKwh,
    deadlineMs: request.deadlineMs,
    message: first.body.error?.message ?? `HTTP ${first.status}`,
  };
}
