import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, type CurrentSession, type Forecast } from '../api';
import { clockTime, countdown, kwh, percent } from '../format';
import { summarisePlan } from '../plan';
import { theme } from '../theme';
import {
  Button,
  Card,
  Chip,
  DeepCard,
  FactRow,
  Label,
  Notice,
  ProgressBar,
  Ring,
  Screen,
  ScreenHeader,
} from '../components/ui';

const PEAK_SLOTS = 8; // two hours at a quarter-hour step: the block the evening peak occupies.

/** The dirtiest two-hour block in the forecast — what this session is being compared against. */
function dirtiestBlock(forecast: Forecast): { startMs: number; renewableShare: number } | null {
  const { carbonGPerKwh: carbon, renewableShare: share, startMs, stepMinutes } = forecast;
  if (carbon.length < PEAK_SLOTS) return null;
  let bestStart = 0;
  let bestCarbon = -1;
  for (let start = 0; start + PEAK_SLOTS <= carbon.length; start += 1) {
    let total = 0;
    for (let offset = 0; offset < PEAK_SLOTS; offset += 1) total += carbon[start + offset] ?? 0;
    if (total > bestCarbon) {
      bestCarbon = total;
      bestStart = start;
    }
  }
  let shareTotal = 0;
  for (let offset = 0; offset < PEAK_SLOTS; offset += 1) shareTotal += share[bestStart + offset] ?? 0;
  return { startMs: startMs + bestStart * stepMinutes * 60_000, renewableShare: shareTotal / PEAK_SLOTS };
}

/**
 * What the driver sees while the car is drawing power. Everything here is measured: the power is
 * the charger's last meter value, the share is the grid's, the finish time is the plan's.
 */
export function LiveScreen({
  current,
  forecast,
  nowMs,
  onChanged,
  onStopped,
}: {
  current: CurrentSession;
  forecast: Forecast | null;
  nowMs: number;
  onChanged: () => void;
  onStopped: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = current.session;
  const summary = summarisePlan(current, forecast, nowMs);
  const soc = current.socPercent ?? null;
  const progress = Math.min(1, session.energyDeliveredKwh / Math.max(0.1, session.energyNeededKwh));
  const shareNow = forecast?.renewableShare[0] ?? null;
  const peak = forecast ? dirtiestBlock(forecast) : null;
  const delta = shareNow !== null && peak ? shareNow - peak.renewableShare : null;

  const act = (run: Promise<unknown>, after: () => void): void => {
    setBusy(true);
    setError(null);
    void run
      .then(after)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  return (
    <Screen>
      <ScreenHeader
        eyebrow={summary && !summary.chargingNow ? 'Holding for a cleaner hour' : 'Charging in a clean window'}
        title={session.currentPowerKw > 0.05 ? 'Powering up with the grid.' : 'Waiting for the cleanest hour.'}
      />

      <DeepCard style={styles.hero}>
        <Ring
          percent={soc ?? progress}
          caption={soc === null ? 'of tonight’s need' : 'charged'}
        />
      </DeepCard>

      <Card>
        <FactRow
          facts={[
            { label: 'Added', value: kwh(session.energyDeliveredKwh) },
            { label: 'Power', value: `${session.currentPowerKw.toFixed(1)} kW` },
            {
              label: 'Time left',
              value: summary ? countdown(summary.endMs, nowMs) : countdown(session.deadlineMs, nowMs),
            },
          ]}
        />
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Label>Live renewable share</Label>
          {delta !== null && Math.abs(delta) > 0.01 ? (
            <Chip tone={delta > 0 ? 'green' : 'amber'}>
              {`${delta > 0 ? '▲' : '▼'} ${Math.abs(Math.round(delta * 100))} pts vs ${clockTime(peak?.startMs ?? 0)}`}
            </Chip>
          ) : null}
        </View>
        <Text style={styles.share}>{shareNow === null ? '—' : `${percent(shareNow)} clean energy`}</Text>
        <View style={{ marginTop: theme.space(3) }}>
          <ProgressBar value={shareNow ?? 0} />
        </View>
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.readyLabel}>Car ready by</Text>
          <Text style={styles.readyValue}>
            {clockTime(session.deadlineMs)} · {session.deadlineRisk ? 'at risk' : 'guaranteed'}
          </Text>
        </View>
        <View style={{ marginTop: theme.space(3) }}>
          <ProgressBar value={progress} />
        </View>
        <Text style={styles.muted}>
          {kwh(session.energyDeliveredKwh)} of {kwh(session.energyNeededKwh)} delivered ·{' '}
          {kwh(current.remainingKwh)} to go
        </Text>
      </Card>

      {error ? <Notice tone="red">{error}</Notice> : null}

      {session.mode === 'fastest' ? null : (
        <>
          <Button
            title="Charge now instead"
            tone="quiet"
            disabled={busy}
            onPress={() => act(api.updateSession(session.id, { mode: 'fastest' }), onChanged)}
          />
          <View style={{ height: theme.space(2) }} />
        </>
      )}
      <Button
        title={busy ? 'Working…' : 'Stop charging'}
        tone="danger"
        disabled={busy}
        onPress={() => act(api.stopSession(session.id), onStopped)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: theme.space(6) },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  share: { fontSize: 22, fontWeight: '700', color: theme.ink, marginTop: 2 },
  readyLabel: { fontSize: 13.5, color: theme.muted },
  readyValue: { fontSize: 15, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  muted: { fontSize: 12.5, color: theme.muted, marginTop: theme.space(2), fontVariant: ['tabular-nums'] },
});
