import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, type Charger, type Forecast } from '../api';
import { clockTime, percent } from '../format';
import { carbonColor, theme } from '../theme';
import { Button, Card, CarbonRibbon, Label } from '../components/ui';

/** Where the driver starts: how clean the day looks, and which bay they are at. */
export function HomeScreen({
  driverName,
  onPickCharger,
}: {
  driverName: string;
  onPickCharger: (charger: Charger) => void;
}) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [chargers, setChargers] = useState<Charger[]>([]);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([api.forecast(), api.chargers()])
      .then(([nextForecast, nextChargers]) => {
        setForecast(nextForecast);
        setChargers(nextChargers);
        setError(null);
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  const now = forecast?.carbonGPerKwh[0] ?? null;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.hello}>Hello, {driverName.split(' ')[0]}</Text>
      <Text style={styles.sub}>Riverside Office Car Park</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <Card>
        <Label>Grid right now</Label>
        {now === null ? (
          <ActivityIndicator color={theme.accent} />
        ) : (
          <>
            <Text style={[styles.big, { color: carbonColor(now) }]}>
              {Math.round(now)} <Text style={styles.unit}>gCO2/kWh</Text>
            </Text>
            <Text style={styles.muted}>{percent(forecast?.renewableShare[0] ?? 0)} of the grid is renewable</Text>
          </>
        )}
      </Card>

      {forecast && (
        <Card>
          <Label>Next 24 hours</Label>
          <CarbonRibbon
            carbon={forecast.carbonGPerKwh}
            startMs={forecast.startMs}
            stepMinutes={forecast.stepMinutes}
          />
          {forecast.greenWindow && (
            <Text style={styles.window}>
              Cleanest window: {clockTime(forecast.greenWindow.startMs)} to {clockTime(forecast.greenWindow.endMs)},{' '}
              {percent(forecast.greenWindow.avgRenewableShare)} renewable
            </Text>
          )}
        </Card>
      )}

      {picking ? (
        <Card>
          <Label>Which bay are you at?</Label>
          {chargers.map((charger) => (
            <Pressable
              key={charger.id}
              onPress={() => onPickCharger(charger)}
              style={({ pressed }) => [styles.bay, pressed && { opacity: 0.7 }]}
            >
              <View>
                <Text style={styles.bayName}>{charger.label}</Text>
                <Text style={styles.muted}>
                  {charger.id} · up to {charger.maxPowerKw} kW
                </Text>
              </View>
              <Text style={[styles.bayState, { color: charger.online ? theme.accent : theme.faint }]}>
                {charger.online ? 'ready' : 'offline'}
              </Text>
            </Pressable>
          ))}
          <Button title="Cancel" tone="quiet" onPress={() => setPicking(false)} />
        </Card>
      ) : (
        <Button title="Start a charging session" onPress={() => setPicking(true)} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: theme.space(5), paddingTop: theme.space(12), backgroundColor: theme.bg, flexGrow: 1 },
  hello: { fontSize: 28, fontWeight: '700', color: theme.ink },
  sub: { fontSize: 15, color: theme.muted, marginBottom: theme.space(5) },
  big: { fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 15, color: theme.muted, fontWeight: '500' },
  muted: { color: theme.muted, fontSize: 13 },
  window: { marginTop: theme.space(3), color: theme.ink, fontSize: 14, fontWeight: '600' },
  bay: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.space(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  bayName: { fontSize: 16, fontWeight: '600', color: theme.ink },
  bayState: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: '700' },
  error: { color: theme.red, marginBottom: theme.space(3) },
});
