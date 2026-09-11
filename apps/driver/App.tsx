import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, getDriverId, syncClock, type Charger, type CurrentSession, type Report, type Vehicle } from './src/api';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveScreen } from './src/screens/LiveScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { SummaryScreen } from './src/screens/SummaryScreen';
import { theme } from './src/theme';

/**
 * Four screens and no navigation library: the app is a single flow, and which screen is showing
 * follows from whether there is a live session.
 */

const POLL_MS = 5_000;

export default function App() {
  const [driverName, setDriverName] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [current, setCurrent] = useState<CurrentSession | null>(null);
  const [charger, setCharger] = useState<Charger | null>(null);
  const [finished, setFinished] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    void api
      .current()
      .then((next) => {
        setCurrent((previous) => {
          // A session that has just ended becomes the summary screen.
          if (previous && !next) void api.report(previous.session.id).then(setFinished).catch(() => undefined);
          return next;
        });
        setError(null);
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // Work in the server's clock: during a demo it runs far ahead of the phone's.
    void syncClock().catch(() => undefined);
    const clockTimer = setInterval(() => void syncClock().catch(() => undefined), 30_000);
    void api
      .me()
      .then((me) => setDriverName(me.displayName))
      .catch(() => setDriverName(getDriverId()));
    void api
      .vehicles()
      .then((vehicles) => setVehicle(vehicles[0] ?? null))
      .catch(() => undefined);
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      clearInterval(timer);
      clearInterval(clockTimer);
    };
  }, [refresh]);

  const body = (): React.ReactNode => {
    if (loading) return <ActivityIndicator color={theme.accent} style={{ marginTop: 80 }} />;
    if (finished) return <SummaryScreen report={finished} onDone={() => setFinished(null)} />;
    if (current) {
      return (
        <LiveScreen
          current={current}
          onStopped={() => {
            setCharger(null);
            refresh();
          }}
        />
      );
    }
    if (charger) {
      return (
        <SetupScreen
          charger={charger}
          vehicle={vehicle}
          onStarted={() => {
            setCharger(null);
            refresh();
          }}
          onCancel={() => setCharger(null)}
        />
      );
    }
    return <HomeScreen driverName={driverName ?? 'driver'} onPickCharger={setCharger} />;
  };

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {error && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Cannot reach CleanGrid: {error}</Text>
        </View>
      )}
      {body()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  banner: { backgroundColor: '#fdeceb', padding: theme.space(3) },
  bannerText: { color: theme.red, fontSize: 13, textAlign: 'center' },
});
