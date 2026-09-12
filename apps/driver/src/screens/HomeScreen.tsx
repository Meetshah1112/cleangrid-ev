import { StyleSheet, Text, View } from 'react-native';
import type { ChargingMode, CurrentSession, Forecast, SiteSummary, Vehicle } from '../api';
import { clockTime, countdown, kwh, localHour, percent } from '../format';
import { MODE_COPY, carbonColor, greeting, theme } from '../theme';
import {
  Button,
  Card,
  CarbonStrip,
  CarGlyph,
  Chip,
  DeepCard,
  Label,
  Screen,
  StatTile,
} from '../components/ui';

/**
 * Home answers the only question that matters before any of the others: will my car be ready,
 * and is the scheduler doing anything about it right now.
 */
export function HomeScreen({
  driverName,
  site,
  vehicle,
  current,
  forecast,
  nowMs,
  defaultMode,
  onStart,
  onOpenPlan,
  onStop,
}: {
  driverName: string;
  site: SiteSummary | null;
  vehicle: Vehicle | null;
  current: CurrentSession | null;
  forecast: Forecast | null;
  nowMs: number;
  defaultMode: ChargingMode;
  onStart: () => void;
  onOpenPlan: () => void;
  onStop?: (() => void) | undefined;
}) {
  const session = current?.session ?? null;
  const carbonNow = forecast?.carbonGPerKwh[0] ?? null;
  const shareNow = forecast?.renewableShare[0] ?? null;
  const soc = current?.socPercent ?? null;
  const waiting = session !== null && session.currentPowerKw <= 0.05;

  return (
    <Screen>
      <View style={styles.head}>
        <Text style={styles.greeting}>
          {greeting(localHour(nowMs))}, {driverName.split(' ')[0]}
        </Text>
        <Text style={styles.headline}>
          {session ? (waiting ? 'Your EV is plugged in.' : 'Your EV is charging.') : 'Ready when you are.'}
        </Text>
      </View>

      <DeepCard style={styles.hero}>
        <CarGlyph />
        <Text style={styles.heroCar}>
          {vehicle?.label ?? 'Your car'} · {site?.name ?? 'no site'}
        </Text>
        <View style={styles.heroRow}>
          <Text style={styles.heroReady}>
            {session ? `Ready by ${clockTime(session.deadlineMs)}` : 'Nothing plugged in'}
          </Text>
          <View style={styles.battery}>
            <View style={[styles.batteryFill, { width: `${Math.max(6, (soc ?? 0.12) * 100)}%` }]} />
          </View>
        </View>

        <View style={styles.heroStats}>
          <StatTile
            onDeep
            value={soc === null ? (session ? kwh(session.energyDeliveredKwh) : '—') : percent(soc)}
            label={soc === null ? 'Delivered tonight' : 'Current charge'}
          />
          <View style={{ width: theme.space(2) }} />
          <StatTile
            onDeep
            value={session ? `+${kwh(current?.remainingKwh ?? 0)}` : '—'}
            label={session ? 'Needed tonight' : 'No request yet'}
          />
        </View>

        <View style={{ marginTop: theme.space(4) }}>
          <Chip tone="lime">
            {session
              ? waiting
                ? `● ${MODE_COPY[session.mode]?.title ?? session.mode} plan is on`
                : `● Charging at ${session.currentPowerKw.toFixed(1)} kW · ${MODE_COPY[session.mode]?.title ?? session.mode}`
              : `○ Not charging · ${MODE_COPY[defaultMode]?.title ?? defaultMode} when you plug in`}
          </Chip>
        </View>
      </DeepCard>

      <Card>
        <Label>Grid right now</Label>
        {carbonNow === null || !forecast ? (
          <Text style={styles.muted}>Waiting for grid data…</Text>
        ) : (
          <>
            <View style={styles.rowBetween}>
              <Text style={[styles.big, { color: carbonColor(carbonNow) }]}>
                {Math.round(carbonNow)} <Text style={styles.unit}>gCO₂/kWh</Text>
              </Text>
              <Text style={styles.share}>{percent(shareNow ?? 0)} renewable</Text>
            </View>
            <View style={{ marginTop: theme.space(3) }}>
              <CarbonStrip
                carbon={forecast.carbonGPerKwh}
                startMs={forecast.startMs}
                stepMinutes={forecast.stepMinutes}
                highlightFrom={forecast.greenWindow?.startMs ?? null}
                highlightTo={forecast.greenWindow?.endMs ?? null}
              />
            </View>
            {forecast.greenWindow ? (
              <Text style={styles.window}>
                Cleanest window {clockTime(forecast.greenWindow.startMs)}–{clockTime(forecast.greenWindow.endMs)},{' '}
                {percent(forecast.greenWindow.avgRenewableShare)} renewable
              </Text>
            ) : null}
          </>
        )}
      </Card>

      {session ? (
        <>
          <Card>
            <Label>Your promise</Label>
            <Text style={styles.promise}>
              {kwh(session.energyDeliveredKwh)} of {kwh(session.energyNeededKwh)} delivered
            </Text>
            <Text style={styles.muted}>
              {session.deadlineRisk
                ? 'At risk — the site is constrained. We are giving you priority.'
                : `Guaranteed by ${clockTime(session.deadlineMs)}, ${countdown(session.deadlineMs, nowMs)} from now.`}
            </Text>
          </Card>
          <Button title="See tonight's plan" tone="deep" onPress={onOpenPlan} />
          {onStop ? (
            <>
              <View style={{ height: theme.space(2) }} />
              <Button title="Stop and unplug" tone="quiet" onPress={onStop} />
            </>
          ) : null}
        </>
      ) : (
        <Button title="Start a charging session" onPress={onStart} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { marginBottom: theme.space(4) },
  greeting: { fontSize: 14, color: theme.muted },
  headline: { fontSize: 27, fontWeight: '700', color: theme.ink, letterSpacing: -0.6, marginTop: 2 },
  hero: { paddingTop: theme.space(3) },
  heroCar: { fontSize: 12.5, color: theme.mutedOnDeep, marginTop: theme.space(3) },
  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  heroReady: { flex: 1, fontSize: 20, fontWeight: '700', color: theme.inkOnDeep },
  battery: {
    width: 62,
    height: 29,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: theme.lime,
    padding: 3,
    justifyContent: 'center',
  },
  batteryFill: { height: '100%', backgroundColor: theme.lime, borderRadius: 5 },
  heroStats: { flexDirection: 'row', marginTop: theme.space(4) },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  big: { fontSize: 29, fontWeight: '700', fontVariant: ['tabular-nums'] },
  unit: { fontSize: 13, color: theme.muted, fontWeight: '500' },
  share: { fontSize: 14, color: theme.green, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 13, lineHeight: 19 },
  window: { marginTop: theme.space(3), color: theme.ink, fontSize: 13.5, fontWeight: '600' },
  promise: { fontSize: 17, fontWeight: '700', color: theme.ink, marginBottom: 4, fontVariant: ['tabular-nums'] },
});
