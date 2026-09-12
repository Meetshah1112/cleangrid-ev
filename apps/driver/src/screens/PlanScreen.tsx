import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, type ChargingMode, type CurrentSession, type Forecast, type ModePreview } from '../api';
import { clockTime, countdown, kwh, money, percent } from '../format';
import { cleanerBy, summarisePlan } from '../plan';
import { theme, type } from '../theme';
import { ModePicker } from '../components/ModePicker';
import { Valley } from '../components/Valley';
import { PlanRibbon, planFrame } from '../components/ValleyLayers';
import { Button, Figure, ForestBand, Notice, Screen, Section, Status, Stepper, TextLink } from '../components/ui';

/**
 * The plan screen exists to make one claim inspectable: we moved your energy, we did not move your
 * deadline. Every number here is read back from the plan the optimiser actually dispatched, and the
 * valley above draws that plan across the hours it will happen in.
 */
export function PlanScreen({
  current,
  forecast,
  nowMs,
  onDone,
  onChanged,
}: {
  current: CurrentSession;
  forecast: Forecast | null;
  nowMs: number;
  onDone: () => void;
  onChanged: () => void;
}) {
  const session = current.session;
  const [previews, setPreviews] = useState<ModePreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The deadline being edited, which is not the same as the one in force. Held locally and sent on
   * confirm rather than on every press, because each send re-solves the site and the deadline passes
   * through unreachable values on its way down to a reachable one.
   */
  const [wanted, setWanted] = useState(session.deadlineMs);
  const summary = summarisePlan(current, forecast, nowMs);
  const frame = planFrame(current, nowMs);
  const charged = current.remainingKwh <= 0.05;

  // Follow the session if it changes underneath.
  useEffect(() => {
    setWanted(session.deadlineMs);
  }, [session.deadlineMs]);

  const loadPreviews = useCallback(() => {
    if (current.remainingKwh <= 0.05) {
      setPreviews(null);
      return;
    }
    void api
      .preview({
        energyKwh: Math.max(1, Math.round(current.remainingKwh)),
        deadlineAt: new Date(session.deadlineMs).toISOString(),
        maxPowerKw: session.maxPowerKw,
      })
      .then((preview) => setPreviews(preview.modes))
      .catch(() => setPreviews(null));
  }, [current.remainingKwh, session.deadlineMs, session.maxPowerKw]);

  useEffect(loadPreviews, [loadPreviews]);

  const switchMode = (mode: ChargingMode): void => {
    if (mode === session.mode || busy) return;
    setBusy(true);
    setError(null);
    void api
      .updateSession(session.id, { mode })
      .then(() => onChanged())
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  const moved = Math.abs(wanted - session.deadlineMs) >= 60_000;

  const saveDeadline = (): void => {
    if (!moved || busy) return;
    setBusy(true);
    setError(null);
    void api
      .updateSession(session.id, { deadlineAt: new Date(wanted).toISOString() })
      .then(() => onChanged())
      // The server refuses a deadline it cannot deliver and says the earliest it can, so this is
      // an answer about the car rather than a failure to reach the server.
      .catch((caught: Error) => {
        setError(caught.message);
        setWanted(session.deadlineMs);
      })
      .finally(() => setBusy(false));
  };

  const cleaner = summary ? cleanerBy(summary) : 0;

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
            <Text style={[type.eyebrow, { color: geometry.tone === 'light' ? theme.onForestMuted : theme.stone }]}>Your intelligent plan</Text>
            <Text style={[type.display, geometry.tone === 'light' && { color: theme.onForest }]} accessibilityRole="header" textBreakStrategy="balanced">
              {charged
                ? 'Charged and ready.'
                : summary === null
                  ? 'Working out your plan.'
                  : summary.chargingNow
                    ? 'Charging while the grid is clean.'
                    : 'Waiting for cleaner power.'}
            </Text>
          </View>
        )}
      </Valley>

      <ForestBand>
        {summary ? (
          <>
            <View style={styles.bandHead}>
              <Text style={styles.bandTitle}>
                {clockTime(summary.startMs)} to {clockTime(summary.endMs)}
              </Text>
              <Status tone={session.deadlineRisk ? 'risk' : 'onForest'}>{session.deadlineRisk ? 'At risk' : 'Guaranteed'}</Status>
            </View>
            <Text style={styles.bandSub}>
              {summary.chargingNow
                ? `Your deadline is protected, and this is the cleanest window inside it.`
                : `Your deadline is protected. Charging starts in ${countdown(summary.startMs, nowMs)}.`}
            </Text>
            <View style={styles.bandFigures}>
              <Figure size="small" onForest accent={theme.lime} value={kwh(summary.energyKwh)} label="scheduled" />
              <Figure size="small" onForest value={money(summary.cost)} label={`vs ${money(summary.baselineCost)} charging now`} />
              <Figure size="small" onForest value={percent(summary.renewableShare)} label="renewable" />
            </View>
          </>
        ) : (
          <Text style={styles.bandSub}>
            {charged
              ? `Your car has the ${kwh(session.energyNeededKwh)} it asked for. Nothing is left to schedule before ${clockTime(session.deadlineMs)}.`
              : 'No plan yet for this session. It appears after the next solve, usually within a minute.'}
          </Text>
        )}
      </ForestBand>
    </>
  );

  return (
    <Screen hero={hero}>
      {summary ? (
        <Text style={[type.body, styles.claim]}>
          {cleaner > 0.01
            ? `Your plan moves ${kwh(summary.energyKwh)} into hours ${percent(cleaner)} cleaner than charging now, without changing when you leave.`
            : 'The grid is flat across your window, so charging now is already the clean choice.'}
        </Text>
      ) : null}

      <Section label="When do you need it?">
        <Text style={[type.caption, styles.gapBelow]}>
          {moved
            ? `Currently promised for ${clockTime(session.deadlineMs)}. Confirm to move it.`
            : 'Move this and the plan re-solves around the new time. Your car still gets what you asked for.'}
        </Text>
        <Stepper
          value={wanted}
          onChange={setWanted}
          step={30 * 60_000}
          min={nowMs + 20 * 60_000}
          max={nowMs + 36 * 60 * 60_000}
          format={(value) => clockTime(value)}
          label="time"
        />
        {moved ? (
          <View style={styles.gapAbove}>
            <Button title={busy ? 'Asking' : `Move my deadline to ${clockTime(wanted)}`} onPress={saveDeadline} disabled={busy} />
          </View>
        ) : null}
      </Section>

      <Section label="What matters most?">
        <Text style={[type.caption, styles.gapBelow]}>
          Used inside your {clockTime(session.deadlineMs)} deadline. Changing it re-solves the plan immediately.
        </Text>
        {error ? <Notice tone="risk">{error}</Notice> : null}
        {charged ? (
          <Text style={type.body}>Your car is already charged, so there is nothing for a preference to change on this session.</Text>
        ) : (
          <ModePicker mode={session.mode} onChange={switchMode} previews={previews} />
        )}
      </Section>

      <View style={styles.actions}>
        <Button title="Keep this plan" onPress={onDone} />
        <TextLink title="Back to home" onPress={onDone} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCopy: { paddingHorizontal: theme.space(5), paddingTop: theme.space(5), gap: theme.space(2) },
  bandHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(3) },
  bandTitle: { flex: 1, fontFamily: type.title.fontFamily, fontSize: 26, lineHeight: 34, color: theme.lime },
  bandSub: { ...type.caption, color: theme.onForestMuted, marginTop: theme.space(1) },
  bandFigures: { flexDirection: 'row', marginTop: theme.space(4), gap: theme.space(3) },
  claim: { color: theme.stone, marginTop: theme.space(1) },
  gapBelow: { marginBottom: theme.space(3) },
  gapAbove: { marginTop: theme.space(3) },
  actions: { marginTop: theme.space(6), gap: theme.space(1) },
});
