'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Charger, Demand, Dispatch, FlexEvent, Forecast, Overview, Plan, Session, SiteEvent } from './types';

/**
 * Live state for one site. The console loads a snapshot over REST, then follows the WebSocket
 * channel; if the socket drops it keeps polling, so the numbers are never silently stale.
 */

export interface LiveSite {
  overview: Overview | null;
  plan: Plan | null;
  sessions: Session[];
  chargers: Charger[];
  forecast: Forecast | null;
  flexEvents: FlexEvent[];
  dispatches: Dispatch[];
  demand: Demand | null;
  nowMs: number;
  timeScale: number;
  connected: boolean;
  error: string | null;
  refresh: () => void;
}

const POLL_MS = 5_000;

export function useLiveSite(siteId: string | null): LiveSite {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [flexEvents, setFlexEvents] = useState<FlexEvent[]>([]);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [demand, setDemand] = useState<Demand | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [timeScale, setTimeScale] = useState(1);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tickRef = useRef<number>(Date.now());

  const refresh = useCallback(() => {
    if (!siteId) return;
    void (async () => {
      try {
        const [nextOverview, nextSessions, nextChargers, nextFlex, nextDispatches, nextDemand] = await Promise.all([
          api.overview(siteId),
          api.sessions(siteId),
          api.chargers(siteId),
          api.flexEvents(siteId).catch(() => []),
          api.dispatchLog(siteId).catch(() => []),
          api.demand(siteId).catch(() => null),
        ]);
        setOverview(nextOverview);
        setSessions(nextSessions);
        setChargers(nextChargers);
        setFlexEvents(nextFlex);
        setDispatches(nextDispatches);
        setDemand(nextDemand);
        setNowMs(nextOverview.nowMs);
        tickRef.current = Date.now();
        setError(null);
        const [nextPlan, nextForecast] = await Promise.all([
          api.plan(siteId).catch(() => null),
          api.forecast(siteId).catch(() => null),
        ]);
        setPlan(nextPlan);
        if (nextForecast) setForecast(nextForecast);
      } catch (caught) {
        setError((caught as Error).message);
      }
    })();
  }, [siteId]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  // Keep the displayed clock moving between server ticks, at the server's own speed.
  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed = Date.now() - tickRef.current;
      tickRef.current = Date.now();
      setNowMs((current) => current + elapsed * timeScale);
    }, 1_000);
    return () => clearInterval(timer);
  }, [timeScale]);

  useEffect(() => {
    if (!siteId) return undefined;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = (): void => {
      socket = new WebSocket(api.socketUrl(siteId));
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 3_000);
      };
      socket.onerror = () => socket?.close();
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as SiteEvent;
        switch (event.type) {
          case 'clock.tick':
            setNowMs(event.nowMs);
            setTimeScale(event.scale);
            tickRef.current = Date.now();
            break;
          case 'plan.solved':
            setPlan(event.plan);
            break;
          case 'session.updated':
            setSessions((current) => {
              const others = current.filter((session) => session.id !== event.session.id);
              const previous = current.find((session) => session.id === event.session.id);
              return [{ ...event.session, driverName: previous?.driverName ?? null }, ...others];
            });
            break;
          case 'meter.updated':
            setSessions((current) =>
              current.map((session) =>
                session.id === event.sessionId
                  ? { ...session, currentPowerKw: event.powerKw, energyDeliveredKwh: event.energyKwh }
                  : session,
              ),
            );
            break;
          case 'charger.updated':
            setChargers((current) =>
              current.map((charger) =>
                charger.id === event.charger.id ? { ...event.charger, connectors: event.connectors } : charger,
              ),
            );
            break;
          case 'flex.updated':
            setFlexEvents((current) => [event.flex, ...current.filter((flex) => flex.id !== event.flex.id)]);
            break;
          case 'dispatch.sent':
            setDispatches((current) => [event.dispatch, ...current].slice(0, 12));
            break;
          default:
            break;
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [siteId]);

  return {
    overview,
    plan,
    sessions,
    chargers,
    forecast,
    flexEvents,
    dispatches,
    demand,
    nowMs,
    timeScale,
    connected,
    error,
    refresh,
  };
}
