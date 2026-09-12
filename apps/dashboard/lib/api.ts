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
  Session,
  Site,
} from './types';

/** One place that knows where the server is and how this console identifies itself. */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8080';

/**
 * The console watches a network of sites, so it signs in as the network operator rather than as any
 * one site's operator. A single-site operator is refused at every other site, which is correct for
 * them and wrong for this screen.
 */
const operator: HeadersInit = {
  'x-dev-role': 'operator',
  'x-dev-user': process.env.NEXT_PUBLIC_OPERATOR_ID ?? 'ops-network',
};

/** The grid operator is a different person with a different view; the API treats them as one. */
const gridOperator: HeadersInit = {
  'x-dev-role': 'grid_operator',
  'x-dev-user': process.env.NEXT_PUBLIC_GRID_OPERATOR_ID ?? 'grid-ops',
};

async function request<T>(path: string, init?: RequestInit, as: HeadersInit = operator): Promise<T> {
  // Only claim a JSON body when there is one; an empty body with a JSON content type is an error.
  const headers = init?.body === undefined ? as : { ...as, 'content-type': 'application/json' };
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || body.ok !== true) {
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
  sessions: (siteId: string) => request<Session[]>(`/sites/${siteId}/sessions?limit=100`),
  chargers: (siteId: string) => request<Charger[]>(`/sites/${siteId}/chargers`),
  forecast: (siteId: string, hours = 24) => request<Forecast>(`/sites/${siteId}/forecast?hours=${hours}`),
  flexEvents: (siteId: string) => request<FlexEvent[]>(`/sites/${siteId}/flex-events`),
  dispatchLog: (siteId: string, limit = 12) => request<Dispatch[]>(`/sites/${siteId}/dispatch-log?limit=${limit}`),
  impact: (siteId: string) => request<Impact>(`/sites/${siteId}/reports`),
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
  socketUrl: (siteId: string) => `${API_BASE.replace(/^http/, 'ws')}/ws/sites/${siteId}`,
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
