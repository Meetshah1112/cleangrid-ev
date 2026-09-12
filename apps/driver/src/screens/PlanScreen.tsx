import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, type ChargingMode, type CurrentSession, type Forecast, type ModePreview } from '../api';
import { clockTime, countdown, kwh, money, percent } from '../format';
import { cleanerBy, summarisePlan } from '../plan';
import { theme } from '../theme';
import { ModePicker } from '../components/ModePicker';
import {
  Button,
  Card,
  CarbonStrip,
  Chip,
  Label,
  Notice,
  Screen,
  ScreenHeader,
  Stepper,
  TextLink,
} from '../components/ui';

/**
 * The plan screen exists to make one claim inspectable: we moved your energy, we did not move your
 * deadline. Every number here is read back from the plan the optimiser actually dispatched.
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
   * The deadline being edited, which is not the same as the one in force.
   *
   * Moving it is the driver's half of the only conversation that matters here -- the app promises
   * a time and the driver is the one who knows whether it is still the right time. Plans change
   * after a car is plugged in, and until now the screen named the deadline in its own copy while
   * offering no way to touch it: the operator could move it from the console and the person it
   * belonged to could not.
   *
   * Held locally and sent on confirm rather than on every press, because each send re-solves the
   * site and the deadline passes through unreachable values on its way down to a reachable one.
   */
  const [wanted, setWanted] = useState(session.deadlineMs);
  const summary = summarisePlan(current, forecast, nowMs);

  // Follow the session if it changes underneath, unless the driver is mid-edit.
  useEffect(() => {
    setWanted(session.deadlineMs);
  }, [session.deadlineMs]);

  const loadPreviews = useCallback(() => {
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

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Tonight's intelligent plan"
        title={
          summary === null
            ? 'Working out your plan.'
            : summary.chargingNow
              ? 'Charging while the grid is clean.'
              : "We'll wait for cleaner power."
        }
        subtitle={
          summary === null
            ? 'The optimiser re-solves every few minutes; your plan appears as soon as it has run.'
            : `Your deadline is protected. ${summary.chargingNow ? 'This is the cleanest window inside it.' : `Charging starts in ${countdown(summary.startMs, nowMs)}.`}`
        }
      />

      {summary && forecast ? (
        <>
          <Card>
            <Label>Best clean window</Label>
            <CarbonStrip
              carbon={forecast.carbonGPerKwh}
              startMs={forecast.startMs}
              stepMinutes={forecast.stepMinutes}
              highlightFrom={summary.startMs}
              highlightTo={summary.endMs}
              height={30}
            />
            <View style={styles.rowBetween}>
              <Text style={styles.claim}>Renewable share in your window {percent(summary.renewableShare)}</Text>
              <Chip>{session.deadlineRisk ? 'At risk' : 'Guaranteed'}</Chip>
            </View>
          </Card>

          <Card>
            <Label>Scheduled charge</Label>
            <View style={styles.rowBaseline}>
              <Text style={styles.window}>
                {clockTime(summary.startMs)} – {clockTime(summary.endMs)}
              </Text>
              <Text style={styles.windowEnergy}>{kwh(summary.energyKwh)}</Text>
            </View>
            <View style={styles.line}>
              <Text style={styles.lineLabel}>Expected session cost</Text>
              <Text style={styles.lineValue}>{money(summary.cost)}</Text>
            </View>
            <View style={styles.line}>
              <Text style={styles.lineLabel}>If you charged right now</Text>
              <Text style={[styles.lineValue, styles.strike]}>{money(summary.baselineCost)}</Text>
            </View>
            <Text style={styles.footnote}>
              {cleaner > 0.01
                ? `Your plan moves ${kwh(summary.energyKwh)} into hours ${percent(cleaner)} cleaner than charging now, without changing when you leave.`
                : 'The grid is flat across your window, so charging now is already the clean choice.'}
            </Text>
          </Card>
        </>
      ) : (
        <Card>
          <Text style={styles.muted}>
            No plan yet for this session. It appears after the next solve — usually within a minute.
          </Text>
        </Card>
      )}

      <View style={{ marginTop: theme.space(3), marginBottom: theme.space(2) }}>
        <Label>When do you need it?</Label>
        <Text style={styles.muted}>
          {moved
            ? `Currently promised for ${clockTime(session.deadlineMs)}. Confirm to move it.`
            : 'Move this and the plan re-solves around the new time. Your car still gets what you asked for.'}
        </Text>
      </View>
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
        <Button
          title={busy ? 'Asking…' : `Move my deadline to ${clockTime(wanted)}`}
          tone="deep"
          onPress={saveDeadline}
          disabled={busy}
        />
      ) : null}

      <View style={{ marginTop: theme.space(3), marginBottom: theme.space(2) }}>
        <Label>What matters most?</Label>
        <Text style={styles.muted}>
          Used inside your {clockTime(session.deadlineMs)} deadline. Changing it re-solves the plan immediately.
        </Text>
      </View>
      {error ? <Notice tone="red">{error}</Notice> : null}
      <View style={{ height: theme.space(3) }} />
      <ModePicker mode={session.mode} onChange={switchMode} previews={previews} />

      <Button title="Keep this plan" tone="deep" onPress={onDone} />
      <TextLink title="Back to home" onPress={onDone} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.space(3),
    gap: theme.space(2),
  },
  rowBaseline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  claim: { flex: 1, fontSize: 13.5, color: theme.ink, fontWeight: '600' },
  window: { fontSize: 21, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  windowEnergy: { fontSize: 14, color: theme.muted, fontVariant: ['tabular-nums'] },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: theme.space(3),
  },
  lineLabel: { fontSize: 13.5, color: theme.muted },
  lineValue: { fontSize: 15.5, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  strike: { textDecorationLine: 'line-through', color: theme.faint, fontWeight: '600' },
  footnote: { marginTop: theme.space(3), fontSize: 12.5, color: theme.muted, lineHeight: 18 },
  muted: { fontSize: 13, color: theme.muted, lineHeight: 19 },
});
