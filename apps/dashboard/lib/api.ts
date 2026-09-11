import type { Charger, Dispatch, FlexEvent, Forecast, Impact, Overview, Plan, Session } from './types';

/** One place that knows where the server is and how this dashboard identifies itself. */

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8080';
export const SITE_ID = process.env.NEXT_PUBLIC_SITE_ID ?? 'site-riverside';

const identity: HeadersInit = {
  'x-dev-role': 'operator',
  'x-dev-user': process.env.NEXT_PUBLIC_OPERATOR_ID ?? 'ops-priya',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only claim a JSON body when there is one; an empty body with a JSON content type is an error.
  const headers = init?.body === undefined ? identity : { ...identity, 'content-type': 'application/json' };
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: 'no-store' });
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error?.message ?? `${path} failed with HTTP ${response.status}`);
  }
  return body.data as T;
}

export const api = {
  overview: () => request<Overview>(`/sites/${SITE_ID}/overview`),
  plan: () => request<Plan>(`/sites/${SITE_ID}/plans/latest`),
  sessions: () => request<Session[]>(`/sites/${SITE_ID}/sessions?limit=100`),
  chargers: () => request<Charger[]>(`/sites/${SITE_ID}/chargers`),
  forecast: () => request<Forecast>(`/sites/${SITE_ID}/forecast?hours=24`),
  flexEvents: () => request<FlexEvent[]>(`/sites/${SITE_ID}/flex-events`),
  dispatchLog: () => request<Dispatch[]>(`/sites/${SITE_ID}/dispatch-log?limit=12`),
  impact: () => request<Impact>(`/sites/${SITE_ID}/reports`),
  replan: () => request<{ planId?: string; status?: string }>(`/sites/${SITE_ID}/replan`, { method: 'POST' }),
  respondToFlex: (eventId: string, accept: boolean) =>
    request<FlexEvent>(`/sites/${SITE_ID}/flex-events/${eventId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    }),
  socketUrl: () => `${API_BASE.replace(/^http/, 'ws')}/ws/sites/${SITE_ID}`,
};
