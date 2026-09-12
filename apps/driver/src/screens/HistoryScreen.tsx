import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Forecast, Report, Session, SiteSummary } from '../api';
import { clockTime, dayStamp, kwh, monthLabel, money, percent, sameMonth, weekday } from '../format';
import { MODE_COPY, theme } from '../theme';
import { Card, Chip, DeepCard, Divider, Label, Screen, ScreenHeader } from '../components/ui';

type HistoryRow = Session & { report: Report | null };

/**
 * The record that makes the claim cumulative: not one good session, a habit with numbers attached.
 */
export function HistoryScreen({
  rows,
  sites,
  forecast,
  nowMs,
}: {
  rows: HistoryRow[] | null;
  sites: SiteSummary[];
  forecast: Forecast | null;
  nowMs: number;
}) {
  const siteName = (id: string): string => sites.find((site) => site.id === id)?.name ?? 'Site';
  const finished = (rows ?? []).filter((row) => row.report !== null);
  const thisMonth = finished.filter((row) => sameMonth(row.pluggedInMs, nowMs));
  const avoidedKg = thisMonth.reduce((total, row) => total + (row.report?.avoidedCo2Kg ?? 0), 0);
  const savedMoney = thisMonth.reduce((total, row) => total + (row.report?.costSaved ?? 0), 0);
  const averageScore =
    finished.length === 0
      ? null
      : Math.round(finished.reduce((total, row) => total + (row.report?.greenScore ?? 0), 0) / finished.length);

  return (
    <Screen>
      <ScreenHeader eyebrow="Your charging footprint" title="Cleaner with every session." />

      <View style={styles.banner}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerValue}>
            {avoidedKg.toFixed(1)} <Text style={styles.bannerUnit}>kg CO₂ avoided</Text>
          </Text>
          <Text style={styles.bannerSub}>
            in {monthLabel(nowMs)} · {money(savedMoney)} saved
          </Text>
        </View>
        {averageScore === null ? null : <Chip>Avg score {averageScore}</Chip>}
      </View>

      <Card>
        <View style={styles.rowBetween}>
          <Label>Recent sessions</Label>
          <Text style={styles.month}>{monthLabel(nowMs)}</Text>
        </View>

        {rows === null ? (
          <ActivityIndicator color={theme.green} style={{ marginVertical: theme.space(6) }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>Nothing yet. Your first session will show up here with its Green Score.</Text>
        ) : (
          rows.map((row, index) => {
            const stamp = dayStamp(row.pluggedInMs);
            return (
              <View key={row.id}>
                {index > 0 ? <Divider /> : <View style={{ height: theme.space(2) }} />}
                <View style={styles.row}>
                  <View style={styles.stamp}>
                    <Text style={styles.stampDay}>{stamp.day}</Text>
                    <Text style={styles.stampMonth}>{stamp.month}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {siteName(row.siteId)} · {MODE_COPY[row.mode]?.title ?? row.mode}
                    </Text>
                    <Text style={styles.rowFacts}>
                      {kwh(row.energyDeliveredKwh)}
                      {row.report ? ` · ${percent(row.report.renewableShare)} renewable` : ' · in progress'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.scoreValue}>{row.report ? Math.round(row.report.greenScore) : '—'}</Text>
                    <Text style={styles.scoreLabel}>Green Score</Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </Card>

      {forecast?.greenWindow ? (
        <DeepCard>
          <Text style={styles.bestLabel}>Your best time to plug in</Text>
          <Text style={styles.bestValue}>
            {weekday(forecast.greenWindow.startMs)} · {clockTime(forecast.greenWindow.startMs)}–
            {clockTime(forecast.greenWindow.endMs)}
          </Text>
          <View style={{ marginTop: theme.space(3) }}>
            <Chip tone="lime">{percent(forecast.greenWindow.avgRenewableShare)} renewable in that window</Chip>
          </View>
        </DeepCard>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    backgroundColor: theme.limeSoft,
    borderRadius: theme.radius,
    padding: theme.space(4),
    marginBottom: theme.space(3),
  },
  bannerValue: { fontSize: 27, fontWeight: '800', color: theme.deep, fontVariant: ['tabular-nums'] },
  bannerUnit: { fontSize: 13, fontWeight: '600', color: theme.ink },
  bannerSub: { fontSize: 12.5, color: theme.muted, marginTop: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { fontSize: 12, color: theme.faint },
  empty: { fontSize: 13, color: theme.muted, marginTop: theme.space(2), lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.space(3) },
  stamp: { width: 34, alignItems: 'center' },
  stampDay: { fontSize: 16, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  stampMonth: { fontSize: 10.5, color: theme.faint, textTransform: 'uppercase' },
  rowTitle: { fontSize: 14.5, fontWeight: '600', color: theme.ink },
  rowFacts: { fontSize: 12, color: theme.muted, marginTop: 1, fontVariant: ['tabular-nums'] },
  scoreValue: { fontSize: 16, fontWeight: '700', color: theme.green, fontVariant: ['tabular-nums'] },
  scoreLabel: { fontSize: 10, color: theme.faint },
  bestLabel: { fontSize: 12.5, color: theme.mutedOnDeep },
  bestValue: { fontSize: 19, fontWeight: '700', color: theme.inkOnDeep, marginTop: 2 },
});
