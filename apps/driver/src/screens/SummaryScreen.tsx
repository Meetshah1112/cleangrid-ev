import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Report } from '../api';
import { co2Equivalent, kwh, money, percent } from '../format';
import { theme } from '../theme';
import { Button, Card, Label } from '../components/ui';

/** What the session actually did, measured from the meter rather than promised by the plan. */
export function SummaryScreen({ report, onDone }: { report: Report; onDone: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.title}>Charging finished</Text>

      <Card style={styles.hero}>
        <Label>Green score</Label>
        <Text style={styles.score}>{report.greenScore}</Text>
        <Text style={styles.heroSub}>
          {report.greenScore >= 80
            ? 'You charged on the cleanest power your window offered.'
            : report.greenScore >= 50
              ? 'A good share of your charging landed on cleaner power.'
              : 'Your window was too tight to move much charging.'}
        </Text>
      </Card>

      <Card>
        <Label>CO2 avoided</Label>
        <Text style={styles.figure}>{report.avoidedCo2Kg.toFixed(2)} kg</Text>
        <Text style={styles.muted}>{co2Equivalent(report.avoidedCo2Kg)}</Text>
      </Card>

      <Card>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Energy</Text>
          <Text style={styles.rowValue}>{kwh(report.energyKwh)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Cost</Text>
          <Text style={styles.rowValue}>{money(report.cost)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Saved against charging on plug-in</Text>
          <Text style={styles.rowValue}>{money(report.costSaved)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Renewable share</Text>
          <Text style={styles.rowValue}>{percent(report.renewableShare)}</Text>
        </View>
      </Card>

      <Text style={styles.badge}>
        {report.verified ? '✓ Verified from charger meter readings' : 'Estimated: meter data was incomplete'}
      </Text>

      <Button title="Done" onPress={onDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: theme.space(5), paddingTop: theme.space(12), backgroundColor: theme.bg, flexGrow: 1 },
  title: { fontSize: 26, fontWeight: '700', color: theme.ink, marginBottom: theme.space(5) },
  hero: { backgroundColor: theme.accentSoft, borderColor: theme.accent },
  score: { fontSize: 64, fontWeight: '800', color: theme.accent, fontVariant: ['tabular-nums'] },
  heroSub: { color: '#12563a', fontSize: 14, marginTop: theme.space(1) },
  figure: { fontSize: 34, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  muted: { color: theme.muted, fontSize: 13, marginTop: theme.space(1) },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: theme.space(2),
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
  },
  rowLabel: { color: theme.muted, fontSize: 14, flexShrink: 1, paddingRight: theme.space(3) },
  rowValue: { color: theme.ink, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  badge: { fontSize: 12, color: theme.muted, textAlign: 'center', marginBottom: theme.space(4) },
});
