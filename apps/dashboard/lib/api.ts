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

const operator: HeadersInit = {
  'x-dev-role': 'operator',
  'x-dev-user': process.env.NEXT_PUBLIC_OPERATOR_ID ?? 'ops-priya',
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
  replan: (siteId: string) => request<{ planId?: string; status?: string }>(`/sites/${siteId}/replan`, { method: 'POST' }),
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
  /** Ask a site to hold below a share of its connection for a while. */
  requestReduction: (input: {
    siteId: string;
    reductionPct: number;
    hours: number;
    connectionKw: number;
    nowMs: number;
  }) => {
    const startsAt = new Date(input.nowMs + 60_000).toISOString();
    const endsAt = new Date(input.nowMs + 60_000 + input.hours * 3_600_000).toISOString();
    const capKw = Math.round(input.connectionKw * (1 - input.reductionPct / 100) * 10) / 10;
    return request<FlexEvent>(
      '/grid/flex-events',
      {
        method: 'POST',
        body: JSON.stringify({
          siteId: input.siteId,
          startsAt,
          endsAt,
          capKw,
          reason: `network constraint: hold ${input.reductionPct}% below the connection`,
        }),
      },
      gridOperator,
    );
  },
};
