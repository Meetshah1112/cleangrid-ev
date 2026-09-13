import type {
  Charger,
  Demand,
  Dispatch,
  FlexEvent,
  Forecast,
  GridSite,
  Impact,
  Overview,
  Plan,
  Preview,
  Session,
  SessionReport,
  Site,
} from './types';
import { ACCESS_ERRORS, clearAccess, currentAccess, type Account } from './access';

/** One place that knows where the server is and how this console identifies itself. */

// A trailing slash, as a host's dashboard tends to copy it, would double every path after it.
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');

/**
 * Every call carries the access code the console was signed in with, and the server acts as the
 * account that code belongs to. The development headers ride along for a laptop server running
 * without codes, which ignores the code; a server with codes ignores the headers.
 */
const withCode = (devRole: string, devUser: string): Record<string, string> => {
  const access = currentAccess();
  return {
    'x-dev-role': devRole,
    'x-dev-user': devUser,
    ...(access ? { 'x-access-code': access.code } : {}),
  };
};

const operator = (): Record<string, string> => withCode('operator', process.env.NEXT_PUBLIC_OPERATOR_ID ?? 'ops-network');

/** The grid operator is a different person with a different view; on a laptop server it is a different header. */
const gridOperator = (): Record<string, string> => withCode('grid_operator', process.env.NEXT_PUBLIC_GRID_OPERATOR_ID ?? 'grid-ops');

async function request<T>(path: string, init?: RequestInit, as: () => Record<string, string> = operator): Promise<T> {
  // Only claim a JSON body when there is one; an empty body with a JSON content type is an error.
  const identity = as();
  const headers = init?.body === undefined ? identity : { ...identity, 'content-type': 'application/json' };
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } };
  if (!response.ok || body.ok !== true) {
    // The code was changed or the account no longer exists: send the visitor back to the gate.
    const code = body.error?.code;
    if (code && ACCESS_ERRORS.has(code) && currentAccess()) clearAccess();
    throw new Error(body.error?.message ?? `${path} failed with HTTP ${response.status}`);
  }
  return body.data as T;
}

export const api = {
  me: () => request<{ id: string; role: string; displayName: string; siteId: string | null }>('/me'),
  sites: () => request<Site[]>('/sites'),
  clock: () => request<{ nowMs: number; scale: number }>('/clock'),
  overview: (siteId: string) => request<Overview>(`/sites/${siteId}/overview`),
  plan: (siteId: string) => request<Plan>(`/sites/${siteId}/plans/latest`),
  /** Sessions in one state, newest first, for history that reaches further back than the live list. */
  sessionsWithStatus: (siteId: string, status: 'complete' | 'aborted', limit = 500) =>
    request<Session[]>(`/sites/${siteId}/sessions?status=${status}&limit=${limit}`),
  /**
   * The cars on site now, plus recent history.
   *
   * The newest hundred sessions are not guaranteed to include the ones still plugged in: a store
   * that outlives a run keeps sessions stamped later than this run's clock, and those sort first.
   * Asking for active and pending sessions by status as well means a car on a bay is never missing
   * from the console because of what an earlier run left behind.
   */
  sessions: async (siteId: string) => {
    const [recent, active, pending] = await Promise.all([
      request<Session[]>(`/sites/${siteId}/sessions?limit=100`),
      request<Session[]>(`/sites/${siteId}/sessions?status=active&limit=200`),
      request<Session[]>(`/sites/${siteId}/sessions?status=pending&limit=200`),
    ]);
    const live = [...active, ...pending];
    const liveIds = new Set(live.map((session) => session.id));
    return [...live, ...recent.filter((session) => !liveIds.has(session.id))];
  },
  chargers: (siteId: string) => request<Charger[]>(`/sites/${siteId}/chargers`),
  forecast: (siteId: string, hours = 24) => request<Forecast>(`/sites/${siteId}/forecast?hours=${hours}`),
  flexEvents: (siteId: string) => request<FlexEvent[]>(`/sites/${siteId}/flex-events`),
  dispatchLog: (siteId: string, limit = 12) => request<Dispatch[]>(`/sites/${siteId}/dispatch-log?limit=${limit}`),
  /** A period of the site's measured impact. Without a range the server reports the last 30 days. */
  impact: (siteId: string, range?: { fromMs: number; toMs: number }) =>
    request<Impact>(
      range
        ? `/sites/${siteId}/reports?from=${new Date(range.fromMs).toISOString()}&to=${new Date(range.toMs).toISOString()}`
        : `/sites/${siteId}/reports`,
    ),
  /** One session's proof. Provisional while the car is still charging. */
  sessionReport: (sessionId: string) => request<SessionReport>(`/sessions/${sessionId}/report`),
  /**
   * What each mode would cost and emit for a request, before anything is changed. Used so an
   * operator sees the consequence of an override before confirming it rather than after.
   */
  preview: (input: { siteId: string; energyKwh: number; deadlineMs: number; maxPowerKw: number }) =>
    request<Preview>('/sessions/preview', {
      method: 'POST',
      body: JSON.stringify({
        siteId: input.siteId,
        energyKwh: Math.max(0.5, Math.round(input.energyKwh * 10) / 10),
        deadlineAt: new Date(input.deadlineMs).toISOString(),
        maxPowerKw: input.maxPowerKw,
      }),
    }),
  demand: (siteId: string, hours = 24) => request<Demand>(`/sites/${siteId}/demand?hours=${hours}`),
  /**
   * `queued` comes back instead of a plan when the optimiser is switched off at this site, which
   * is the baseline mode: it watches and measures but never intervenes. Saying "re-planned" then
   * would be a lie, so the caller has to be able to tell the two apart.
   */
  /**
   * An operator override. The server re-checks that the change can still be delivered in time and
   * refuses it with `deadline_unreachable` if it cannot, rather than accepting a promise it would
   * then break, so the caller must show what comes back instead of assuming it took.
   */
  patchSession: (sessionId: string, body: { mode?: string; deadlineAt?: string; energyKwh?: number }) =>
    request<Session>(`/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  replan: (siteId: string) =>
    request<{ planId?: string; status?: string; solver?: string; queued?: boolean }>(`/sites/${siteId}/replan`, {
      method: 'POST',
    }),
  respondToFlex: (siteId: string, eventId: string, accept: boolean) =>
    request<FlexEvent>(`/sites/${siteId}/flex-events/${eventId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    }),
  // A browser cannot put headers on a WebSocket, so the access code travels in the URL.
  socketUrl: (siteId: string) => {
    const code = currentAccess()?.code;
    return `${API_BASE.replace(/^http/, 'ws')}/ws/sites/${siteId}${code ? `?code=${encodeURIComponent(code)}` : ''}`;
  },
  /** Who an access code signs in as. A code that belongs to nobody is refused. */
  accountFor: async (code: string): Promise<Account> => {
    const headers = { ...operator(), 'x-access-code': code };
    const response = await fetch(`${API_BASE}/me`, { headers, cache: 'no-store' }).catch(() => {
      throw new Error('The CleanGrid server could not be reached. Check the connection and try again.');
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; data?: Account; error?: { message?: string } };
    if (!response.ok || body.ok !== true || !body.data) throw new Error(body.error?.message ?? `the server answered HTTP ${response.status}`);
    return body.data;
  },
};

export const gridApi = {
  sites: () => request<GridSite[]>('/grid/sites', undefined, gridOperator),
  events: (siteId: string) => request<FlexEvent[]>(`/grid/flex-events?siteId=${siteId}`, undefined, gridOperator),
  /**
   * Ask a site to cut what it is drawing, for a while.
   *
   * The reduction is a share of current draw, not of the connection. A site running at half its
   * connection would be handed a "40% reduction" that asks for nothing at all, which is not what a
   * network operator means when they need load off the feeder now.
   */
  requestReduction: (input: {
    siteId: string;
    reductionPct: number;
    hours: number;
    drawKw: number;
    connectionKw: number;
    nowMs: number;
  }) => {
    const startsAt = new Date(input.nowMs + 60_000).toISOString();
    const endsAt = new Date(input.nowMs + 60_000 + input.hours * 3_600_000).toISOString();
    const from = input.drawKw > 0.5 ? input.drawKw : input.connectionKw;
    const capKw = Math.round(from * (1 - input.reductionPct / 100) * 10) / 10;
    return request<FlexEvent>(
      '/grid/flex-events',
      {
        method: 'POST',
        body: JSON.stringify({
          siteId: input.siteId,
          startsAt,
          endsAt,
          capKw,
          reason: `network constraint: ${input.reductionPct}% below the ${Math.round(from)} kW the site was drawing`,
        }),
      },
      gridOperator,
    );
  },
};
