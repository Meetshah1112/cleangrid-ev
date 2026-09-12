import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, type CurrentSession, type Forecast } from '../api';
import { clockTime, countdown, kwh, percent } from '../format';
import { summarisePlan } from '../plan';
import { theme, type } from '../theme';
import { Valley } from '../components/Valley';
import { PlanRibbon, planFrame } from '../components/ValleyLayers';
import { Arc, Button, FactRow, ForestBand, Line, Notice, Screen, Section, Status } from '../components/ui';

const PEAK_SLOTS = 8; // two hours at a quarter-hour step: the block the evening peak occupies.

/** The dirtiest two-hour block in the forecast, which is what this session is being compared against. */
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
  const frame = planFrame(current, nowMs);

  const act = (run: Promise<unknown>, after: () => void): void => {
    setBusy(true);
    setError(null);
    void run
      .then(after)
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  const hero = (
    <>
      <Valley
        startMs={frame.startMs}
        spanMs={frame.spanMs}
        nowMs={nowMs}
        height={360}
        horizon={0.6}
        layers={(geometry) => <PlanRibbon current={current} geometry={geometry} startMs={frame.startMs} spanMs={frame.spanMs} />}
      >
        {(geometry) => (
          <View style={styles.heroCopy}>
            <Text style={[type.eyebrow, { color: geometry.tone === 'light' ? theme.onForestMuted : theme.stone }]}>
              {summary && !summary.chargingNow ? 'Holding for a cleaner hour' : 'Charging in a clean window'}
            </Text>
            <Text style={[type.display, geometry.tone === 'light' && { color: theme.onForest }]} accessibilityRole="header" textBreakStrategy="balanced">
              {session.currentPowerKw > 0.05 ? 'Powering up with the grid.' : 'Waiting for the cleanest hour.'}
            </Text>
          </View>
        )}
      </Valley>

      <ForestBand style={styles.band}>
        <Arc value={soc ?? progress} size={128}>
          <Text style={styles.arcValue}>{percent(soc ?? progress)}</Text>
          <Text style={styles.arcCaption}>{soc === null ? 'of what you need' : 'charged'}</Text>
        </Arc>
        <View style={styles.bandFacts}>
          <FactRow
            onForest
            facts={[
              { label: 'added', value: kwh(session.energyDeliveredKwh) },
              { label: 'power now', value: `${session.currentPowerKw.toFixed(1)} kW` },
            ]}
          />
          <FactRow
            onForest
            facts={[{ label: 'time left in the plan', value: summary ? countdown(summary.endMs, nowMs) : countdown(session.deadlineMs, nowMs) }]}
          />
        </View>
      </ForestBand>
    </>
  );

  return (
    <Screen hero={hero}>
      <Section label="Live renewable share" first>
        <Text style={[type.figure, { color: theme.canopyInk }]}>{shareNow === null ? '--' : `${percent(shareNow)} clean energy`}</Text>
        <View style={styles.lineGap}>
          <Line value={shareNow ?? 0} />
        </View>
        {delta !== null && Math.abs(delta) > 0.01 && peak ? (
          <Text style={[type.caption, styles.after]}>
            {Math.abs(Math.round(delta * 100))} points {delta > 0 ? 'cleaner' : 'less clean'} than the {clockTime(peak.startMs)} peak.
          </Text>
        ) : null}
      </Section>

      <Section label="Car ready by" aside={<Status tone={session.deadlineRisk ? 'risk' : 'good'}>{session.deadlineRisk ? 'At risk' : 'Guaranteed'}</Status>}>
        <Text style={type.figure}>{clockTime(session.deadlineMs)}</Text>
        <View style={styles.lineGap}>
          <Line value={progress} />
        </View>
        <Text style={[type.caption, styles.after]}>
          {kwh(session.energyDeliveredKwh)} of {kwh(session.energyNeededKwh)} delivered, {kwh(current.remainingKwh)} to go.
        </Text>
      </Section>

      {error ? (
        <View style={styles.after}>
          <Notice tone="risk">{error}</Notice>
        </View>
      ) : null}

      <View style={styles.actions}>
        {session.mode === 'fastest' ? null : (
          <Button
            title="Charge now instead"
            tone="quiet"
            disabled={busy}
            onPress={() => act(api.updateSession(session.id, { mode: 'fastest' }), onChanged)}
          />
        )}
        <Button title={busy ? 'Working' : 'Stop charging'} tone="danger" disabled={busy} onPress={() => act(api.stopSession(session.id), onStopped)} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCopy: { paddingHorizontal: theme.space(5), paddingTop: theme.space(5), gap: theme.space(2) },
  band: { flexDirection: 'row', alignItems: 'center', gap: theme.space(5) },
  bandFacts: { flex: 1, gap: theme.space(4) },
  arcValue: { fontFamily: type.figure.fontFamily, fontSize: 30, lineHeight: 40, color: theme.onForest },
  arcCaption: { ...type.caption, fontSize: 11.5, color: theme.onForestMuted, textAlign: 'center', maxWidth: 90 },
  lineGap: { marginTop: theme.space(3) },
  after: { marginTop: theme.space(2) },
  actions: { marginTop: theme.space(6), gap: theme.space(2) },
});
