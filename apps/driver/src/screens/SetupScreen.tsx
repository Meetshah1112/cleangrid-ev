import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import { clockTime, kwh } from '../format';
import { theme } from '../theme';
import { ModePicker } from '../components/ModePicker';
import { Button, Card, ChoiceRow, Label, Notice, Screen, ScreenHeader, Stepper, TextLink } from '../components/ui';

type Step = 'bay' | 'need';

/**
 * The three things the scheduler cannot guess: which bay, how much energy, and by when. Every mode
 * card shows what it would actually cost, because the estimate comes from the scheduler that will run.
 */
export function SetupScreen({
  site,
  vehicle,
  defaultMode,
  onStarted,
  onCancel,
}: {
  site: SiteSummary | null;
  vehicle: Vehicle | null;
  defaultMode: ChargingMode;
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
        setWarning(
          preview.feasible
            ? null
            : `That will not fit. The earliest this bay can finish is ${clockTime(Date.parse(preview.earliestDeadlineAt))}, or ask for ${preview.maxDeliverableKwh} kWh by your time.`,
        );
      })
      .catch((error: Error) => setWarning(error.message));
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
        )}

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
        <Stepper value={energyKwh} onChange={setEnergyKwh} step={1} min={1} max={120} format={(value) => kwh(value)} />
        {vehicle ? (
          <Text style={styles.hint}>
            {vehicle.label} holds {vehicle.batteryKwh} kWh and takes up to {vehicle.maxChargeKw} kW
          </Text>
        ) : null}
      </Card>

      <Card>
        <Label>Ready by</Label>
        <Stepper
          value={deadlineMs}
          onChange={setDeadlineMs}
          step={15 * 60_000}
          min={serverNow() + 15 * 60_000}
          max={serverNow() + 36 * 3_600_000}
          format={(value) => clockTime(value)}
        />
      </Card>

      {warning ? <Notice>{warning}</Notice> : null}

      <View style={{ marginTop: theme.space(2), marginBottom: theme.space(2) }}>
        <Label>What matters tonight?</Label>
      </View>
      <ModePicker mode={mode} onChange={setMode} previews={previews} />

      <Button title={busy ? 'Starting…' : 'Confirm and start'} onPress={start} disabled={busy || !charger} />
      <TextLink title="Back to bays" onPress={() => setStep('bay')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, color: theme.muted, marginTop: theme.space(2) },
});
