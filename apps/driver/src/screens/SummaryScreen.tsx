import { StyleSheet, Text, View } from 'react-native';
import type { Report } from '../api';
import { co2Equivalent, kwh, money, percent } from '../format';
import { theme } from '../theme';
import { Button, Card, Chip, Label, ProgressBar, Screen, ScreenHeader, StatTile } from '../components/ui';

function grade(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Strong';
  if (score >= 55) return 'Good';
  if (score >= 35) return 'Fair';
  return 'Modest';
}

/**
 * Proof, not congratulation. Every figure is the metered session measured against the same session
 * charged the moment it plugged in, and says plainly whether it came from the meter or an estimate.
 */
export function SummaryScreen({ report, onDone }: { report: Report; onDone: () => void }) {
  const baselineCo2Kg = report.co2Kg + report.avoidedCo2Kg;
  const share = baselineCo2Kg > 0 ? report.co2Kg / baselineCo2Kg : 1;

  return (
    <Screen>
      <ScreenHeader eyebrow="Session complete" title="A better charge, measured." />

      <View style={styles.scorePanel}>
        <Text style={styles.score}>{Math.round(report.greenScore)}</Text>
        <Text style={styles.scoreLabel}>Green Score · {grade(report.greenScore)}</Text>
        <View style={{ marginTop: theme.space(3) }}>
          <Chip>{percent(report.renewableShare)} renewable energy</Chip>
        </View>
      </View>

      <View style={styles.tiles}>
        <StatTile
          value={`${report.avoidedCo2Kg.toFixed(1)} kg`}
          label="CO₂ avoided vs. charge now"
          accent={theme.green}
        />
        <View style={{ width: theme.space(3) }} />
        <StatTile value={money(report.costSaved)} label="Saved on this session" accent={theme.green} />
      </View>

      <Card>
        <View style={styles.rowBetween}>
          <Label>{kwh(report.energyKwh)} moved to cleaner hours</Label>
          <Text style={report.verified ? styles.verified : styles.estimated}>
            {report.verified ? 'Verified' : 'Estimated'}
          </Text>
        </View>
        <View style={styles.rowBaseline}>
          <Text style={styles.strike}>{baselineCo2Kg.toFixed(1)} kg</Text>
          <Text style={styles.actual}>{report.co2Kg.toFixed(1)} kg CO₂</Text>
        </View>
        <View style={{ marginTop: theme.space(3) }}>
          <ProgressBar value={share} />
        </View>
        <Text style={styles.footnote}>
          {report.verified
            ? 'Measured from the charger’s own meter against the grid carbon actually recorded during your session.'
            : 'Estimated from the plan: some meter readings were missing for this session.'}
        </Text>
      </Card>

      <Card>
        <Label>What that means</Label>
        <Text style={styles.equivalence}>{co2Equivalent(report.avoidedCo2Kg)}</Text>
        <Text style={styles.footnote}>
          {kwh(report.energyKwh)} delivered · {money(report.cost)} · {percent(report.renewableShare)} renewable
        </Text>
      </Card>

      <Button title="Done" onPress={onDone} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scorePanel: {
    backgroundColor: theme.limeSoft,
    borderRadius: theme.radius,
    padding: theme.space(5),
    marginBottom: theme.space(3),
  },
  score: { fontSize: 66, lineHeight: 72, fontWeight: '800', color: theme.deep, fontVariant: ['tabular-nums'] },
  scoreLabel: { fontSize: 14, color: theme.ink, fontWeight: '600' },
  tiles: { flexDirection: 'row', marginBottom: theme.space(3) },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowBaseline: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space(3), marginTop: theme.space(1) },
  strike: { fontSize: 15, color: theme.faint, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] },
  actual: { fontSize: 19, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  verified: { fontSize: 12, fontWeight: '700', color: theme.green },
  estimated: { fontSize: 12, fontWeight: '700', color: theme.amber },
  footnote: { marginTop: theme.space(3), fontSize: 12.5, color: theme.muted, lineHeight: 18 },
  equivalence: { fontSize: 16, fontWeight: '600', color: theme.ink, lineHeight: 22 },
});
