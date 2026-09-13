import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  SafeAreaView,
  StatusBar as RNStatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  api,
  ApiError,
  getSiteId,
  isOffline,
  serverNow,
  setAccessCode,
  setDriverId,
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
import { ACCESS_ERRORS, clearAccess, loadAccess, saveAccess, type DriverAccess } from './src/access';
import { setLocale } from './src/format';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveScreen } from './src/screens/LiveScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { Notice, TabBar, type Tab } from './src/components/ui';
import { fonts, theme } from './src/theme';

/**
 * The four faces the app draws with, loaded from the files themselves rather than the packages'
 * index, which would bundle every weight of both families.
 */
const FONT_FILES = {
  [fonts.serif]: require('@expo-google-fonts/hedvig-letters-serif/400Regular/HedvigLettersSerif_400Regular.ttf'),
  [fonts.sans]: require('@expo-google-fonts/schibsted-grotesk/400Regular/SchibstedGrotesk_400Regular.ttf'),
  [fonts.sansSemiBold]: require('@expo-google-fonts/schibsted-grotesk/600SemiBold/SchibstedGrotesk_600SemiBold.ttf'),
  [fonts.sansBold]: require('@expo-google-fonts/schibsted-grotesk/700Bold/SchibstedGrotesk_700Bold.ttf'),
};

/**
 * Four tabs and no navigation library: the app is small enough that which screen shows follows from
 * the tab and from whether there is a live session.
 */

const POLL_MS = 5_000;
const CLOCK_SYNC_MS = 30_000;
const TICK_MS = 1_000;

type HistoryRow = Session & { report: Report | null };

/** Points every request at the chosen account, before any screen for it asks for data. */
function applyAccess(access: DriverAccess): void {
  setDriverId(access.driverId);
  setAccessCode(access.code);
  if (access.siteId) setSiteId(access.siteId);
}

/**
 * The fonts and the remembered account come first. Nothing asks the server for anything until the
 * phone knows who it is, so a missing or retired code lands on sign-in rather than on a screen of errors.
 */
export default function App() {
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const [access, setAccess] = useState<DriverAccess | null | undefined>(undefined);

  useEffect(() => {
    void loadAccess().then((stored) => {
      if (stored) applyAccess(stored);
      setAccess(stored);
    });
  }, []);

  const signIn = (next: DriverAccess): void => {
    applyAccess(next);
    void saveAccess(next);
    setAccess(next);
  };

  const signOut = useCallback((): void => {
    setAccessCode('');
    void clearAccess();
    setAccess(null);
  }, []);

  // Hold the first frame on the splash's paper until the faces are in, so nothing is laid out in a fallback
  // font and then jumps. A font that fails to load is no reason to show nothing: carry on without it.
  if ((!fontsLoaded && !fontError) || access === undefined) {
    return (
      <View style={[styles.app, styles.splash]}>
        <StatusBar style="dark" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="dark" />
      {access === null ? (
        <SignInScreen onSignedIn={signIn} />
      ) : (
        // Keyed by driver, so switching account starts from that driver's own car and sessions.
        <DriverApp key={access.driverId} access={access} onSignOut={signOut} />
      )}
    </SafeAreaView>
  );
}

function DriverApp({ access, onSignOut }: { access: DriverAccess; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  const [driverName, setDriverName] = useState<string>(access.driverName);
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
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  // The site's clock and currency drive every formatter, so they are applied before anything renders.
  const site = useMemo(() => sites.find((entry) => entry.id === siteId) ?? null, [sites, siteId]);
  useEffect(() => {
    if (site) setLocale(site.timezone, site.currency, site.country);
  }, [site]);

  const previousSessionId = useRef<string | null>(null);

  // A code the server no longer accepts, or an account it no longer has, ends the sign-in.
  const fail = useCallback(
    (caught: Error): void => {
      if (caught instanceof ApiError && ACCESS_ERRORS.has(caught.code)) onSignOut();
      else setError(caught.message);
    },
    [onSignOut],
  );

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
        setDemo(isOffline());
        setError(null);
      })
      .catch(fail)
      .finally(() => setLoading(false));
  }, [fail]);

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
      .catch(fail);
    void api
      .vehicles()
      .then(setVehicles)
      .catch(() => undefined);
  }, [fail]);

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

  /**
   * The preference is saved on the profile, not held in the phone, and it is applied to a session
   * that is already running. A driver who changes it while plugged in means "charge me that way",
   * and telling them it only counts next time would be a strange answer to give.
   */
  const chooseDefaultMode = (mode: ChargingMode): void => {
    setDefaultMode(mode);
    void api.updateMe({ defaultMode: mode }).catch(fail);
    if (current) {
      void api
        .updateSession(current.session.id, { mode })
        .then(loadSession)
        .catch(fail);
    }
  };

  const selectSite = (id: string): void => {
    setSiteId(id);
    setSite(id);
    setForecast(null);
    setHistory(null);
    loadForecast();
  };

  const body = (): React.ReactNode => {
    if (loading) return <ActivityIndicator color={theme.canopy} style={{ marginTop: 96 }} />;
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
          onDefaultMode={chooseDefaultMode}
          hasLiveSession={current !== null}
          nowMs={nowMs}
          clockScale={clockScale}
          demoAccess={!access.offline}
          onSwitchAccount={onSignOut}
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
          nowMs={nowMs}
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
        defaultMode={defaultMode}
        onStart={() => setTab('plan')}
        onOpenPlan={() => setTab('plan')}
        onStop={
          current
            ? () => {
                void api
                  .stopSession(current.session.id)
                  .then(loadSession)
                  .catch(fail);
              }
            : undefined
        }
      />
    );
  };

  return (
    <>
      <View style={styles.body}>
        {/* A jury must never mistake the built-in snapshot for a live measurement. */}
        {demo ? (
          <View style={styles.errorWrap}>
            <Notice tone="warn">
              Demo data. No CleanGrid server is reachable from this phone, so these figures come from a built-in
              snapshot rather than from live chargers.
            </Notice>
          </View>
        ) : null}
        {error && !demo ? (
          <View style={styles.errorWrap}>
            <Notice tone="risk">The CleanGrid server did not answer ({error}). Figures shown are the last ones received.</Notice>
          </View>
        ) : null}
        {body()}
      </View>
      <TabBar current={tab} onChange={setTab} />
    </>
  );
}

/**
 * Android 16 draws every app edge to edge and SafeAreaView only insets on iOS, so the status bar
 * height has to be reserved here or the first line of every screen sits under the clock.
 */
const TOP_INSET = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0;

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: theme.paper, paddingTop: TOP_INSET },
  splash: { backgroundColor: theme.paper },
  body: { flex: 1 },
  errorWrap: { paddingHorizontal: theme.space(5), paddingTop: theme.space(3) },
});
