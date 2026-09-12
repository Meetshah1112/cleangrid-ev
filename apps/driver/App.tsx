import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  api,
  getDriverId,
  getSiteId,
  serverNow,
  setSiteId,
  syncClock,
  type ChargingMode,
  type CurrentSession,
  type Forecast,
  type Report,
  type Session,
  type SiteSummary,
  type Vehicle,
} from './src/api';
import { setLocale } from './src/format';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveScreen } from './src/screens/LiveScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { Notice, TabBar, type Tab } from './src/components/ui';
import { theme } from './src/theme';

/**
 * Four tabs and no navigation library: the app is small enough that which screen shows follows from
 * the tab and from whether there is a live session.
 */

const POLL_MS = 5_000;
const CLOCK_SYNC_MS = 30_000;
const TICK_MS = 1_000;

type HistoryRow = Session & { report: Report | null };

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [driverName, setDriverName] = useState<string>(getDriverId());
  const [defaultMode, setDefaultMode] = useState<ChargingMode>('balanced');
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [siteId, setSite] = useState<string>(getSiteId());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [current, setCurrent] = useState<CurrentSession | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [finished, setFinished] = useState<Report | null>(null);
  const [clockScale, setClockScale] = useState(1);
  const [nowMs, setNowMs] = useState(() => serverNow());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The site's clock and currency drive every formatter, so they are applied before anything renders.
  const site = useMemo(() => sites.find((entry) => entry.id === siteId) ?? null, [sites, siteId]);
  useEffect(() => {
    if (site) setLocale(site.timezone, site.currency, site.country);
  }, [site]);

  const previousSessionId = useRef<string | null>(null);

  const loadSession = useCallback(() => {
    void api
      .current()
      .then((next) => {
        // A session that has just ended becomes the summary screen, once.
        const previous = previousSessionId.current;
        if (previous && next?.session.id !== previous) {
          void api
            .report(previous)
            .then(setFinished)
            .catch(() => undefined);
          setHistory(null);
        }
        previousSessionId.current = next?.session.id ?? null;
        setCurrent(next);
        setError(null);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  const loadForecast = useCallback(() => {
    void api
      .forecast()
      .then(setForecast)
      .catch(() => undefined);
  }, []);

  const loadHistory = useCallback(() => {
    void api
      .history()
      .then((rows) => setHistory(rows as HistoryRow[]))
      .catch(() => setHistory([]));
  }, []);

  // One-time identity and site load.
  useEffect(() => {
    void syncClock().catch(() => undefined);
    void api
      .clock()
      .then((clock) => setClockScale(clock.scale))
      .catch(() => undefined);
    void api
      .me()
      .then((me) => {
        setDriverName(me.displayName);
        setDefaultMode(me.defaultMode);
      })
      .catch(() => undefined);
    void api
      .sites()
      .then((list) => {
        setSites(list);
        // Fall back to the first site if the configured one is not served by this backend.
        if (!list.some((entry) => entry.id === getSiteId())) {
          const first = list[0];
          if (first) {
            setSiteId(first.id);
            setSite(first.id);
          }
        }
      })
      .catch((caught: Error) => setError(caught.message));
    void api
      .vehicles()
      .then(setVehicles)
      .catch(() => undefined);
  }, []);

  // Polling: the session and the forecast, plus a local tick so countdowns move between polls.
  useEffect(() => {
    loadSession();
    loadForecast();
    const poll = setInterval(() => {
      loadSession();
      loadForecast();
    }, POLL_MS);
    const clock = setInterval(() => void syncClock().catch(() => undefined), CLOCK_SYNC_MS);
    const tick = setInterval(() => setNowMs(serverNow()), TICK_MS);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      clearInterval(tick);
    };
  }, [loadSession, loadForecast, siteId]);

  useEffect(() => {
    if (tab === 'history' && history === null) loadHistory();
  }, [tab, history, loadHistory]);

  const selectSite = (id: string): void => {
    setSiteId(id);
    setSite(id);
    setForecast(null);
    setHistory(null);
    loadForecast();
  };

  const body = (): React.ReactNode => {
    if (loading) return <ActivityIndicator color={theme.green} style={{ marginTop: 96 }} />;
    if (finished) return <SummaryScreen report={finished} onDone={() => setFinished(null)} />;

    if (tab === 'history') {
      return <HistoryScreen rows={history} sites={sites} forecast={forecast} nowMs={nowMs} />;
    }
    if (tab === 'profile') {
      return (
        <ProfileScreen
          driverName={driverName}
          sites={sites}
          siteId={siteId}
          onSelectSite={selectSite}
          vehicles={vehicles}
          defaultMode={defaultMode}
          onDefaultMode={setDefaultMode}
          nowMs={nowMs}
          clockScale={clockScale}
        />
      );
    }
    if (tab === 'plan') {
      if (current) {
        return (
          <PlanScreen
            current={current}
            forecast={forecast}
            nowMs={nowMs}
            onDone={() => setTab('home')}
            onChanged={loadSession}
          />
        );
      }
      return (
        <SetupScreen
          site={site}
          vehicle={vehicles[0] ?? null}
          defaultMode={defaultMode}
          onStarted={() => {
            loadSession();
            setTab('home');
          }}
          onCancel={() => setTab('home')}
        />
      );
    }

    // The home tab follows the car: the live ring while power is flowing, the vehicle hero otherwise.
    if (current && current.session.currentPowerKw > 0.05) {
      return (
        <LiveScreen
          current={current}
          forecast={forecast}
          nowMs={nowMs}
          onChanged={loadSession}
          onStopped={loadSession}
        />
      );
    }
    return (
      <HomeScreen
        driverName={driverName}
        site={site}
        vehicle={vehicles[0] ?? null}
        current={current}
        forecast={forecast}
        nowMs={nowMs}
        onStart={() => setTab('plan')}
        onOpenPlan={() => setTab('plan')}
        onStop={
          current
            ? () => {
                void api
                  .stopSession(current.session.id)
                  .then(loadSession)
                  .catch((caught: Error) => setError(caught.message));
              }
            : undefined
        }
      />
    );
  };

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.body}>
        {error ? (
          <View style={styles.errorWrap}>
            <Notice tone="red">
              {error} — check that the phone and the server are on the same network.
            </Notice>
          </View>
        ) : null}
        {body()}
      </View>
      <TabBar current={tab} onChange={setTab} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: theme.bg },
  body: { flex: 1 },
  errorWrap: { paddingHorizontal: theme.space(5), paddingTop: theme.space(3) },
});
