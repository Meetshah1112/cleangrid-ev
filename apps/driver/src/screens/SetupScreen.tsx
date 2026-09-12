import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ApiError,
  api,
  bayIsFree,
  serverNow,
  type Charger,
  type ChargingMode,
  type ModePreview,
  type SiteSummary,
  type Vehicle,
} from '../api';
import { clockTime, countdown, kwh } from '../format';
import { theme } from '../theme';
import { ModePicker } from '../components/ModePicker';
import { Button, Card, ChoiceRow, Label, Notice, Screen, ScreenHeader, Stepper, TextLink } from '../components/ui';

type Step = 'bay' | 'need';

/**
 * Roughly how far a kilowatt-hour goes in a small EV. Used only to translate the energy target
 * into a distance, which is the unit drivers actually think in; the scheduler never sees it.
 */
const KM_PER_KWH = 5.5;

/** Fractions of the battery, so the common answers are one tap rather than twenty. */
const PRESETS = [0.25, 0.5, 0.8] as const;

/**
 * The three things the scheduler cannot guess: which bay, how much energy, and by when. Every mode
 * card shows what it would actually cost, because the estimate comes from the scheduler that will run.
 */
export function SetupScreen({
  site,
  vehicle,
  defaultMode,
  nowMs,
  onStarted,
  onCancel,
}: {
  site: SiteSummary | null;
  vehicle: Vehicle | null;
  defaultMode: ChargingMode;
  /** The server's clock, which during a demo runs faster than the phone's. */
  nowMs: number;
  onStarted: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>('bay');
  const [chargers, setChargers] = useState<Charger[] | null>(null);
  const [chargersError, setChargersError] = useState<string | null>(null);
  const [charger, setCharger] = useState<Charger | null>(null);

  const [energyKwh, setEnergyKwh] = useState(20);
  const [deadlineMs, setDeadlineMs] = useState(() => serverNow() + 8 * 3_600_000);
  const [mode, setMode] = useState<ChargingMode>(defaultMode);
  const [previews, setPreviews] = useState<ModePreview[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [feasible, setFeasible] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadChargers = useCallback(() => {
    setChargers(null);
    setChargersError(null);
    void api
      .chargers()
      .then((list) => setChargers(list))
      .catch((error: Error) => {
        setChargers([]);
        setChargersError(error.message);
      });
  }, []);

  useEffect(loadChargers, [loadChargers]);

  /**
   * Give the deadline a fresh eight hours whenever this step opens.
   *
   * It is an instant, not a duration, which is right: a driver leaves at a time, not "in a while".
   * But the demo clock runs at up to sixty times real speed, so an instant chosen a few minutes ago
   * has already been overtaken, the request turns infeasible, and every mode comes back at the same
   * price. Re-seeding on arrival keeps the window real.
   */
  useEffect(() => {
    if (step === 'need') setDeadlineMs(serverNow() + 8 * 3_600_000);
  }, [step]);

  const slackMinutes = Math.round((deadlineMs - nowMs) / 60_000);

  const maxPowerKw = charger
    ? Math.min(charger.maxPowerKw, vehicle?.maxChargeKw ?? charger.maxPowerKw)
    : (vehicle?.maxChargeKw ?? 7);

  const refreshPreview = useCallback(() => {
    if (step !== 'need') return;
    setPreviews(null);
    void api
      .preview({ energyKwh, deadlineAt: new Date(deadlineMs).toISOString(), maxPowerKw })
      .then((preview) => {
        setPreviews(preview.modes);
        setFeasible(preview.feasible);
        setWarning(
          preview.feasible
            ? null
            : `There is not enough time. By ${clockTime(deadlineMs)} this bay can deliver at most ${preview.maxDeliverableKwh} kWh. Either ask for less, or move the deadline to ${clockTime(Date.parse(preview.earliestDeadlineAt))} or later.`,
        );
      })
      .catch((error: Error) => {
        setFeasible(true);
        setWarning(error.message);
      });
  }, [step, energyKwh, deadlineMs, maxPowerKw]);

  useEffect(() => {
    const timer = setTimeout(refreshPreview, 250);
    return () => clearTimeout(timer);
  }, [refreshPreview]);

  const start = (): void => {
    if (!charger) return;
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

  if (step === 'bay') {
    return (
      <Screen>
        <ScreenHeader
          eyebrow="Start a session"
          title="Which bay are you at?"
          subtitle={site ? `${site.name} · ${site.gridConnectionKw} kW site connection` : 'Finding your site…'}
        />

        {chargers === null ? (
          <ActivityIndicator color={theme.green} style={{ marginTop: theme.space(8) }} />
        ) : chargers.length === 0 ? (
          <>
            <Notice tone="red">
              {chargersError
                ? `Could not load the bays at this site: ${chargersError}`
                : 'This site has no chargers registered yet.'}
            </Notice>
            <Button title="Try again" tone="quiet" onPress={loadChargers} />
          </>
        ) : (
          <>
            {/* All ten rows greyed out with no explanation reads as a broken screen. */}
            {chargers.every((option) => !option.online) ? (
              <>
                <Notice>
                  None of the {chargers.length} bays here are connected right now, so a session cannot start. The
                  chargers report in over OCPP; if this is the demo rig, its simulator has stopped.
                </Notice>
                <Button title="Check again" tone="quiet" onPress={loadChargers} />
                <View style={{ height: theme.space(3) }} />
              </>
            ) : chargers.every((option) => !bayIsFree(option)) ? (
              <>
                <Notice>Every bay here is taken. Try again when one frees up, or pick another site in Profile.</Notice>
                <Button title="Check again" tone="quiet" onPress={loadChargers} />
                <View style={{ height: theme.space(3) }} />
              </>
            ) : null}
          </>
        )}

        {chargers !== null && chargers.length > 0 ? (
          chargers.map((option) => {
            const free = bayIsFree(option);
            return (
              <ChoiceRow
                key={option.id}
                title={option.label}
                subtitle={
                  !option.online
                    ? 'Offline — pick another bay'
                    : free
                      ? `Up to ${option.maxPowerKw} kW`
                      : 'Another car is plugged in here'
                }
                trailing={!option.online ? 'Offline' : free ? 'Free' : 'In use'}
                disabled={!free}
                selected={charger?.id === option.id}
                onPress={() => {
                  setCharger(option);
                  setStep('need');
                }}
              />
            );
          })
        ) : null}

        <TextLink title="Cancel" onPress={onCancel} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        eyebrow={charger ? `${charger.label} · up to ${maxPowerKw} kW` : 'Session setup'}
        title="How much, and by when?"
        subtitle="We will fit it into the cleanest, cheapest hours inside that window."
      />

      <Card>
        <Label>Energy needed</Label>
        <Stepper
          value={energyKwh}
          onChange={setEnergyKwh}
          step={1}
          min={1}
          max={120}
          format={(value) => kwh(value)}
          label="energy"
        />
        {vehicle ? (
          <>
            <View style={styles.presets}>
              {PRESETS.map((fraction) => {
                const preset = Math.round(vehicle.batteryKwh * fraction);
                return (
                  <Pressable
                    key={fraction}
                    onPress={() => setEnergyKwh(preset)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${Math.round(fraction * 100)} percent, ${preset} kilowatt hours`}
                    accessibilityState={{ selected: energyKwh === preset }}
                    style={({ pressed }) => [
                      styles.preset,
                      energyKwh === preset && styles.presetOn,
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Text style={[styles.presetText, energyKwh === preset && styles.presetTextOn]}>
                      +{Math.round(fraction * 100)}%
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>
              About {Math.round((energyKwh / vehicle.batteryKwh) * 100)}% of the {vehicle.batteryKwh} kWh battery,
              roughly {Math.round(energyKwh * KM_PER_KWH)} km of range.
            </Text>
          </>
        ) : null}
      </Card>

      <Card>
        <Label>Ready by</Label>
        <Stepper
          value={deadlineMs}
          onChange={setDeadlineMs}
          step={30 * 60_000}
          min={nowMs + 20 * 60_000}
          max={nowMs + 36 * 3_600_000}
          format={(value) => clockTime(value)}
          label="time"
        />
        <Text style={styles.hint}>
          {slackMinutes > 0
            ? `${countdown(deadlineMs, nowMs)} from now, at ${maxPowerKw} kW that is up to ${kwh((slackMinutes / 60) * maxPowerKw)}`
            : 'That time has already passed.'}
        </Text>
      </Card>

      {warning ? <Notice tone={feasible ? 'amber' : 'red'}>{warning}</Notice> : null}

      <View style={{ marginTop: theme.space(2), marginBottom: theme.space(2) }}>
        <Label>What matters most?</Label>
        <Text style={styles.hint}>
          {feasible
            ? 'Every option meets your deadline. They differ in what they cost and emit getting there.'
            : 'No option can finish in time, so all four cost the same. Give it more time or ask for less.'}
        </Text>
      </View>
      <View style={feasible ? undefined : styles.dimmed}>
        <ModePicker mode={mode} onChange={setMode} previews={previews} />
      </View>

      <Button
        title={busy ? 'Starting…' : feasible ? 'Confirm and start' : 'Not enough time'}
        onPress={start}
        disabled={busy || !charger || !feasible}
      />
      <TextLink title="Back to bays" onPress={() => setStep('bay')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, color: theme.muted, marginTop: theme.space(2), lineHeight: 17 },
  presets: { flexDirection: 'row', gap: theme.space(2), marginTop: theme.space(3) },
  preset: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: theme.line,
    backgroundColor: theme.card,
  },
  presetOn: { borderColor: theme.green, backgroundColor: theme.greenSoft },
  presetText: { fontSize: 14, fontWeight: '600', color: theme.muted },
  presetTextOn: { color: theme.green },
  dimmed: { opacity: 0.45 },
});
