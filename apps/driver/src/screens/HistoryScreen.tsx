import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { Forecast, Report, Session, SiteSummary } from '../api';
import { clockTime, dayStamp, getCurrency, kwh, monthLabel, money, percent, sameMonth, weekday } from '../format';
import { MODE_COPY, fonts, theme, type } from '../theme';
import { Figure, ForestBand, PageHead, Screen, Section } from '../components/ui';

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
  // Savings are only added up in the currency on screen: rupees saved in Gandhinagar are not pounds.
  const currency = getCurrency();
  const savedMoney = thisMonth
    .filter((row) => (sites.find((site) => site.id === row.siteId)?.currency ?? currency) === currency)
    .reduce((total, row) => total + (row.report?.costSaved ?? 0), 0);
  const averageScore =
    finished.length === 0 ? null : Math.round(finished.reduce((total, row) => total + (row.report?.greenScore ?? 0), 0) / finished.length);

  const hero = (
    <>
      <View style={styles.head}>
        <PageHead eyebrow="Your charging footprint" title="Cleaner with every session." />
      </View>
      <ForestBand>
        <Text style={styles.bandEyebrow}>In {monthLabel(nowMs)}</Text>
        <View style={styles.bandFigures}>
          <Figure
            onForest
            accent={avoidedKg < 0 ? '#ffbfae' : theme.lime}
            value={`${Math.abs(avoidedKg).toFixed(1)} kg`}
            label={avoidedKg < 0 ? 'CO₂ above charging on plug-in' : 'CO₂ avoided'}
          />
          <Figure onForest value={money(Math.abs(savedMoney))} label={savedMoney < 0 ? 'more than on plug-in' : 'saved'} />
          <Figure onForest value={averageScore === null ? '--' : String(averageScore)} label="average Green Score" />
        </View>
      </ForestBand>
    </>
  );

  return (
    <Screen hero={hero}>
      <Section label="Recent sessions" aside={<Text style={type.caption}>{monthLabel(nowMs)}</Text>} first>
        {rows === null ? (
          <ActivityIndicator color={theme.canopy} style={{ marginVertical: theme.space(6) }} />
        ) : rows.length === 0 ? (
          <Text style={type.body}>Nothing yet. Your first session will show up here with its Green Score.</Text>
        ) : (
          rows.map((row) => {
            const stamp = dayStamp(row.pluggedInMs);
            return (
              <View key={row.id} style={styles.row}>
                <View style={styles.stamp}>
                  <Text style={styles.stampDay}>{stamp.day}</Text>
                  <Text style={styles.stampMonth}>{stamp.month}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.strong}>
                    {siteName(row.siteId)}, {(MODE_COPY[row.mode]?.title ?? row.mode).toLowerCase()}
                  </Text>
                  <Text style={type.caption}>
                    {kwh(row.energyDeliveredKwh)}
                    {row.report
                      ? `, ${percent(row.report.renewableShare)} renewable${row.report.verified ? ', meter-verified' : ', estimated'}`
                      : row.status === 'aborted'
                        ? ', interrupted and not scored'
                        : ', still charging'}
                  </Text>
                </View>
                <View style={styles.score}>
                  <Text style={styles.scoreValue}>{row.report ? Math.round(row.report.greenScore) : '--'}</Text>
                  <Text style={styles.scoreLabel}>Green Score</Text>
                </View>
              </View>
            );
          })
        )}
      </Section>

      {forecast?.greenWindow ? (
        <Section label="Your best time to plug in">
          <Text style={type.title}>
            {weekday(forecast.greenWindow.startMs)}, {clockTime(forecast.greenWindow.startMs)} to {clockTime(forecast.greenWindow.endMs)}
          </Text>
          <Text style={[type.caption, { marginTop: theme.space(1) }]}>{percent(forecast.greenWindow.avgRenewableShare)} renewable in that window.</Text>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { paddingHorizontal: theme.space(5), paddingTop: theme.space(5), paddingBottom: theme.space(4) },
  bandEyebrow: { ...type.eyebrow, color: theme.onForestMuted },
  bandFigures: { flexDirection: 'row', gap: theme.space(3), marginTop: theme.space(3) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3),
    borderBottomWidth: 1,
    borderBottomColor: theme.rule,
  },
  stamp: { width: 38, alignItems: 'center' },
  stampDay: { fontFamily: fonts.serif, fontSize: 20, lineHeight: 27, color: theme.forest },
  stampMonth: { fontFamily: fonts.sansSemiBold, fontSize: 10.5, color: theme.pebble, textTransform: 'uppercase' },
  score: { alignItems: 'flex-end' },
  scoreValue: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 30, color: theme.canopyInk },
  scoreLabel: { fontFamily: fonts.sans, fontSize: 10.5, color: theme.pebble },
});
