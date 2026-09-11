import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError, api, serverNow, type Charger, type ChargingMode, type ModePreview, type Vehicle } from '../api';
import { clockTime, kwh, money } from '../format';
import { MODE_COPY, theme } from '../theme';
import { Button, Card, Label, Stepper } from '../components/ui';

/**
 * The only two numbers the scheduler cannot guess: how much energy, and by when. Every mode shows
 * what it would actually cost, because the estimate comes from the same scheduler that will run.
 */
export function SetupScreen({
  charger,
  vehicle,
  onStarted,
  onCancel,
}: {
  charger: Charger;
  vehicle: Vehicle | null;
  onStarted: () => void;
  onCancel: () => void;
}) {
  const [energyKwh, setEnergyKwh] = useState(20);
  const [deadlineMs, setDeadlineMs] = useState(() => serverNow() + 8 * 3_600_000);
  const [mode, setMode] = useState<ChargingMode>('balanced');
  const [previews, setPreviews] = useState<ModePreview[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const maxPowerKw = Math.min(charger.maxPowerKw, vehicle?.maxChargeKw ?? charger.maxPowerKw);

  const refresh = useCallback(() => {
    setPreviews(null);
    void api
      .preview({ energyKwh, deadlineAt: new Date(deadlineMs).toISOString(), maxPowerKw })
      .then((preview) => {
        setPreviews(preview.modes);
        setWarning(
          preview.feasible
            ? null
            : `That will not fit. The earliest this charger can finish is ${clockTime(Date.parse(preview.earliestDeadlineAt))}, or ask for ${preview.maxDeliverableKwh} kWh by your time.`,
        );
      })
      .catch((error: Error) => setWarning(error.message));
  }, [energyKwh, deadlineMs, maxPowerKw]);

  useEffect(() => {
    const timer = setTimeout(refresh, 250);
    return () => clearTimeout(timer);
  }, [refresh]);

  const start = (): void => {
    setBusy(true);
    void api
      .createSession({
        chargerId: charger.id,
        ...(vehicle ? { vehicleId: vehicle.id } : {}),
        energyKwh,
        deadlineAt: new Date(deadlineMs).toISOString(),
        mode,
      })
      .then(() => onStarted())
      .catch((error: ApiError) => {
        const earliest = error.details?.earliestDeadlineAt;
        setWarning(
          earliest
            ? `Not possible by then. The earliest is ${clockTime(Date.parse(earliest))}; at most ${error.details?.maxDeliverableKwh ?? 0} kWh fits before your deadline.`
            : error.message,
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>{charger.label}</Text>
      <Text style={styles.sub}>
        {vehicle ? `${vehicle.label}, ` : ''}charging at up to {maxPowerKw} kW
      </Text>

      <Card>
        <Label>How much energy</Label>
        <Stepper value={energyKwh} onChange={setEnergyKwh} step={1} min={1} max={120} format={(value) => kwh(value)} />
      </Card>

      <Card>
        <Label>Needed by</Label>
        <Stepper
          value={deadlineMs}
          onChange={setDeadlineMs}
          step={15 * 60_000}
          min={serverNow() + 15 * 60_000}
          max={serverNow() + 36 * 3_600_000}
          format={(value) => clockTime(value)}
        />
      </Card>

      {warning && <Text style={styles.warning}>{warning}</Text>}

      <Label>Choose how it charges</Label>
      {previews === null ? (
        <ActivityIndicator color={theme.accent} style={{ marginVertical: theme.space(6) }} />
      ) : (
        previews.map((preview) => {
          const copy = MODE_COPY[preview.mode];
          const selected = preview.mode === mode;
          return (
            <Pressable
              key={preview.mode}
              onPress={() => setMode(preview.mode)}
              style={({ pressed }) => [styles.mode, selected && styles.modeOn, pressed && { opacity: 0.8 }]}
            >
              <View style={styles.modeHead}>
                <Text style={[styles.modeTitle, selected && { color: theme.accent }]}>{copy?.title}</Text>
                <Text style={styles.modeCost}>{money(preview.cost)}</Text>
              </View>
              <Text style={styles.muted}>{copy?.blurb}</Text>
              <Text style={styles.modeFacts}>
                {preview.co2Kg.toFixed(1)} kg CO2 · {Math.round(preview.renewableShare * 100)}% renewable ·{' '}
                {preview.finishByMs ? `done by ${clockTime(preview.finishByMs)}` : 'cannot finish in time'}
              </Text>
              {preview.shortfallKwh > 0.1 && (
                <Text style={styles.shortfall}>{preview.shortfallKwh.toFixed(1)} kWh would be missed</Text>
              )}
            </Pressable>
          );
        })
      )}

      <View style={{ height: theme.space(3) }} />
      <Button title={busy ? 'Starting...' : 'Confirm and plug in'} onPress={start} disabled={busy} />
      <View style={{ height: theme.space(2) }} />
      <Button title="Back" tone="quiet" onPress={onCancel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: theme.space(5), paddingTop: theme.space(12), backgroundColor: theme.bg, flexGrow: 1 },
  title: { fontSize: 24, fontWeight: '700', color: theme.ink },
  sub: { fontSize: 14, color: theme.muted, marginBottom: theme.space(5) },
  muted: { color: theme.muted, fontSize: 13 },
  warning: {
    backgroundColor: '#fff6e5',
    borderColor: theme.amber,
    borderWidth: 1,
    color: '#7a5410',
    padding: theme.space(3),
    borderRadius: 12,
    marginBottom: theme.space(3),
    fontSize: 13,
  },
  mode: {
    backgroundColor: theme.card,
    borderRadius: theme.radius,
    borderWidth: 2,
    borderColor: theme.line,
    padding: theme.space(4),
    marginBottom: theme.space(2),
  },
  modeOn: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  modeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  modeTitle: { fontSize: 17, fontWeight: '700', color: theme.ink },
  modeCost: { fontSize: 17, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  modeFacts: { fontSize: 13, color: theme.ink, marginTop: theme.space(2), fontVariant: ['tabular-nums'] },
  shortfall: { fontSize: 12, color: theme.red, marginTop: theme.space(1) },
});
