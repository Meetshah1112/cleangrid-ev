import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, serverNow, type CurrentSession, type Forecast, type Report } from '../api';
import { clockTime, countdown, kwh, percent } from '../format';
import { carbonColor, theme } from '../theme';
import { Button, Card, Label, PlanTimeline } from '../components/ui';

/**
 * The waiting screen. A paused charger looks broken unless the app says why, so the plan is drawn
 * over the carbon colours and the next start time is spelled out.
 */
export function LiveScreen({ current, onStopped }: { current: CurrentSession; onStopped: () => void }) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const { session, remainingKwh, plannedKw, planGrid } = current;
  const nowMs = serverNow();

  useEffect(() => {
    void api.forecast().then(setForecast).catch(() => undefined);
  }, []);

  useEffect(() => {
    void api
      .report(session.id)
      .then(setReport)
      .catch(() => undefined);
  }, [session.id, session.energyDeliveredKwh]);

  const charging = session.currentPowerKw > 0.05;
  const nextStartSlot = plannedKw?.findIndex((kw) => kw > 0) ?? -1;
  const nextStartMs =
    planGrid && nextStartSlot >= 0 ? planGrid.startMs + nextStartSlot * planGrid.slotMinutes * 60_000 : null;
  const progress = Math.min(1, session.energyDeliveredKwh / Math.max(0.1, session.energyNeededKwh));

  const stop = (): void => {
    setBusy(true);
    void api
      .stopSession(session.id)
      .then(() => onStopped())
      .finally(() => setBusy(false));
  };

  const chargeNow = (): void => {
    setBusy(true);
    void api
      .updateSession(session.id, { mode: 'fastest' })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const sooner = (): void => {
    setBusy(true);
    const earlier = new Date(Math.max(serverNow() + 30 * 60_000, session.deadlineMs - 60 * 60_000)).toISOString();
    void api
      .updateSession(session.id, { deadlineAt: earlier })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.status}>
        {charging
          ? `Charging at ${session.currentPowerKw.toFixed(1)} kW`
          : nextStartMs && nextStartMs > nowMs
            ? `Waiting for cleaner power, starts ${clockTime(nextStartMs)}`
            : session.status === 'pending'
              ? 'Waiting for the cable'
              : 'Paused'}
      </Text>
      <Text style={styles.sub}>
        {session.chargerId} · guaranteed by {clockTime(session.deadlineMs)} ·{' '}
        {countdown(session.deadlineMs, nowMs)} left
      </Text>

      <Card>
        <Label>Green score so far</Label>
        <Text style={[styles.score, { color: theme.accent }]}>{report ? report.greenScore : '--'}</Text>
        <Text style={styles.muted}>
          {report
            ? `${percent(report.renewableShare)} renewable, ${report.avoidedCo2Kg.toFixed(2)} kg CO2 avoided so far`
            : 'measuring from the meter'}
        </Text>
      </Card>

      <Card>
        <Label>Plan for your parked window</Label>
        {plannedKw && forecast ? (
          <PlanTimeline plannedKw={plannedKw} carbon={forecast.carbonGPerKwh} maxPowerKw={session.maxPowerKw} />
        ) : (
          <Text style={styles.muted}>Waiting for the first plan.</Text>
        )}
        <View style={styles.legendRow}>
          <View style={[styles.dot, { backgroundColor: carbonColor(150) }]} />
          <Text style={styles.legendText}>clean</Text>
          <View style={[styles.dot, { backgroundColor: carbonColor(650) }]} />
          <Text style={styles.legendText}>dirty</Text>
        </View>
      </Card>

      <Card>
        <Label>Energy</Label>
        <Text style={styles.energy}>
          {kwh(session.energyDeliveredKwh)} <Text style={styles.muted}>of {kwh(session.energyNeededKwh)}</Text>
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.muted}>{kwh(remainingKwh)} still to go</Text>
        {session.deadlineRisk && <Text style={styles.risk}>This deadline is at risk. The site is full.</Text>}
      </Card>

      <Button title="Charge now at full power" tone="quiet" onPress={chargeNow} disabled={busy} />
      <View style={{ height: theme.space(2) }} />
      <Button title="I need it an hour sooner" tone="quiet" onPress={sooner} disabled={busy} />
      <View style={{ height: theme.space(2) }} />
      <Button title="Stop charging" tone="danger" onPress={stop} disabled={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: theme.space(5), paddingTop: theme.space(12), backgroundColor: theme.bg, flexGrow: 1 },
  status: { fontSize: 24, fontWeight: '700', color: theme.ink },
  sub: { fontSize: 14, color: theme.muted, marginBottom: theme.space(5) },
  muted: { color: theme.muted, fontSize: 13 },
  score: { fontSize: 52, fontWeight: '800', fontVariant: ['tabular-nums'] },
  energy: { fontSize: 24, fontWeight: '700', color: theme.ink, marginBottom: theme.space(2) },
  track: { height: 8, backgroundColor: theme.line, borderRadius: 4, overflow: 'hidden', marginBottom: theme.space(2) },
  fill: { height: '100%', backgroundColor: theme.accent },
  risk: { color: theme.red, marginTop: theme.space(2), fontSize: 13, fontWeight: '600' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: theme.space(2) },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: theme.faint, marginRight: theme.space(3) },
});
