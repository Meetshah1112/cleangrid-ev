import { StyleSheet, Text, View } from 'react-native';
import type { ChargingMode, CurrentSession, Forecast, SiteSummary, Vehicle } from '../api';
import { clockTime, countdown, kwh, localHour, percent } from '../format';
import { MODE_COPY, carbonColor, greeting, theme, type } from '../theme';
import { Valley } from '../components/Valley';
import { ForecastRidge } from '../components/ValleyLayers';
import { Button, Figure, ForestBand, Screen, Section, Status } from '../components/ui';

const HOUR = 3_600_000;

/**
 * Home answers the question that comes before all the others: will my car be ready, and is the
 * scheduler doing anything about it right now. The valley above is the site's next day, with the
 * renewable forecast standing on its meadow and the cleanest window drawn brighter.
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
  const charged = session !== null && (current?.remainingKwh ?? 0) <= 0.05;
  const frameStart = Math.floor(nowMs / HOUR) * HOUR - 3 * HOUR;
  const frameSpan = 24 * HOUR;
  const modeName = (mode: string): string => MODE_COPY[mode]?.title ?? mode;

  const hero = (
    <>
      <Valley
        startMs={frameStart}
        spanMs={frameSpan}
        nowMs={nowMs}
        height={360}
        horizon={0.6}
        layers={(geometry) => (forecast ? <ForecastRidge forecast={forecast} geometry={geometry} startMs={frameStart} spanMs={frameSpan} /> : null)}
      >
        {(geometry) => (
          <View style={styles.heroCopy}>
            <Text style={[type.eyebrow, { color: geometry.tone === 'light' ? theme.onForestMuted : theme.stone }]}>
              {greeting(localHour(nowMs))}, {driverName.split(' ')[0]}
            </Text>
            <Text style={[type.display, styles.heroTitle, geometry.tone === 'light' && styles.onSky]} accessibilityRole="header" textBreakStrategy="balanced">
              {session ? (charged ? 'Your EV is ready.' : waiting ? 'Your EV is plugged in.' : 'Your EV is charging.') : 'Let the sun set the schedule.'}
            </Text>
          </View>
        )}
      </Valley>

      <ForestBand>
        <View style={styles.bandHead}>
          <Text style={styles.bandTitle}>{session ? `Ready by ${clockTime(session.deadlineMs)}` : 'Nothing plugged in'}</Text>
          {session ? (
            <Status tone={session.deadlineRisk ? 'risk' : 'onForest'}>{session.deadlineRisk ? 'At risk' : 'Guaranteed'}</Status>
          ) : null}
        </View>
        <Text style={styles.bandSub}>
          {session
            ? charged
              ? `Charged. Free to leave any time before ${clockTime(session.deadlineMs)}.`
              : waiting
              ? `${modeName(session.mode)} plan is on, holding for a better hour.`
              : `Charging at ${session.currentPowerKw.toFixed(1)} kW on ${modeName(session.mode).toLowerCase()}.`
            : `${vehicle?.label ?? 'Your car'} at ${site?.name ?? 'your site'}. ${modeName(defaultMode)} when you plug in.`}
        </Text>
        {session ? (
          <View style={styles.bandFigures}>
            <Figure onForest accent={theme.lime} value={soc === null ? kwh(session.energyDeliveredKwh) : percent(soc)} label={soc === null ? 'delivered so far' : 'current charge'} />
            <Figure onForest value={kwh(current?.remainingKwh ?? 0)} label="still needed" />
          </View>
        ) : null}
      </ForestBand>
    </>
  );

  return (
    <Screen hero={hero}>
      <Section label="Grid right now" first>
        {carbonNow === null || !forecast ? (
          <Text style={type.caption}>Waiting for grid data.</Text>
        ) : (
          <>
            <View style={styles.gridRow}>
              <Figure value={`${Math.round(carbonNow)} g`} label="CO₂ per kWh right now" accent={carbonColor(carbonNow)} size="large" />
              <Figure value={percent(shareNow ?? 0)} label="renewable" accent={theme.canopyInk} size="large" />
            </View>
            {forecast.greenWindow ? (
              <Text style={[type.body, styles.windowLine]}>
                The cleanest stretch today runs {clockTime(forecast.greenWindow.startMs)} to {clockTime(forecast.greenWindow.endMs)}, at{' '}
                {percent(forecast.greenWindow.avgRenewableShare)} renewable.
              </Text>
            ) : null}
          </>
        )}
      </Section>

      {session ? (
        <Section label="Your promise">
          <Text style={type.subtitle}>
            {kwh(session.energyDeliveredKwh)} of {kwh(session.energyNeededKwh)} delivered
          </Text>
          <Text style={[type.body, styles.promise]}>
            {session.deadlineRisk
              ? 'At risk: the site is short of room right now, so your car is being given priority.'
              : `Guaranteed by ${clockTime(session.deadlineMs)}, ${countdown(session.deadlineMs, nowMs)} from now.`}
          </Text>
          <View style={styles.actions}>
            <Button title="See the plan" onPress={onOpenPlan} />
            {onStop ? <Button title="Stop and unplug" tone="quiet" onPress={onStop} /> : null}
          </View>
        </Section>
      ) : (
        <View style={styles.actions}>
          <Button title="Start a charging session" onPress={onStart} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCopy: { paddingHorizontal: theme.space(5), paddingTop: theme.space(5), gap: theme.space(2) },
  heroTitle: { maxWidth: 320 },
  onSky: { color: theme.onForest },
  bandHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(3) },
  bandTitle: { flex: 1, fontFamily: type.title.fontFamily, fontSize: 26, lineHeight: 34, color: theme.lime },
  bandSub: { ...type.caption, color: theme.onForestMuted, marginTop: theme.space(1) },
  bandFigures: { flexDirection: 'row', marginTop: theme.space(4), gap: theme.space(4) },
  gridRow: { flexDirection: 'row', gap: theme.space(4) },
  windowLine: { marginTop: theme.space(3), color: theme.stone },
  promise: { marginTop: theme.space(1), color: theme.stone },
  actions: { marginTop: theme.space(5), gap: theme.space(2) },
});
