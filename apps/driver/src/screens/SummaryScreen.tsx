import { StyleSheet, Text, View } from 'react-native';
import { serverNow, type Report } from '../api';
import { co2Equivalent, kwh, money, percent } from '../format';
import { theme, type } from '../theme';
import { Valley } from '../components/Valley';
import { Button, Figure, ForestBand, Line, Screen, Section, Status } from '../components/ui';

const HOUR = 3_600_000;

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
  const nowMs = serverNow();
  const avoided = report.avoidedCo2Kg;

  const hero = (
    <>
      <Valley startMs={Math.floor(nowMs / HOUR) * HOUR - 6 * HOUR} spanMs={18 * HOUR} nowMs={nowMs} height={250} horizon={0.6}>
        {(geometry) => (
          <View style={styles.heroCopy}>
            <Text style={[type.eyebrow, { color: geometry.tone === 'light' ? theme.onForestMuted : theme.stone }]}>Session complete</Text>
            <Text style={[type.display, geometry.tone === 'light' && { color: theme.onForest }]} accessibilityRole="header" textBreakStrategy="balanced">
              A better charge, measured.
            </Text>
          </View>
        )}
      </Valley>
      <ForestBand style={styles.band}>
        <View>
          <Text style={styles.score}>{Math.round(report.greenScore)}</Text>
          <Text style={styles.scoreLabel}>Green Score, {grade(report.greenScore).toLowerCase()}</Text>
        </View>
        <View style={styles.bandSide}>
          <Status tone="onForest">{percent(report.renewableShare)} renewable</Status>
          <Status tone="onForest">{report.verified ? 'Meter-verified' : 'Estimated'}</Status>
        </View>
      </ForestBand>
    </>
  );

  return (
    <Screen hero={hero}>
      <View style={styles.figures}>
        <Figure
          value={`${Math.abs(avoided).toFixed(1)} kg`}
          label={avoided < 0 ? 'CO₂ above charging on plug-in' : 'CO₂ avoided against charging on plug-in'}
          accent={avoided < 0 ? theme.coralInk : theme.canopyInk}
        />
        <Figure
          value={money(Math.abs(report.costSaved))}
          label={report.costSaved < 0 ? 'more than charging on plug-in' : 'saved on this session'}
          accent={report.costSaved < 0 ? theme.coralInk : theme.canopyInk}
        />
      </View>

      <Section label={`${kwh(report.energyKwh)} moved to cleaner hours`}>
        <View style={styles.compare}>
          <Text style={styles.baseline}>{baselineCo2Kg.toFixed(1)} kg on plug-in</Text>
          <Text style={type.subtitle}>{report.co2Kg.toFixed(1)} kg CO₂ with CleanGrid</Text>
        </View>
        <View style={{ marginTop: theme.space(3) }}>
          <Line value={share} />
        </View>
        <Text style={[type.caption, { marginTop: theme.space(3) }]}>
          {report.verified
            ? 'Measured from the charger’s own meter against the grid carbon recorded during your session.'
            : 'Estimated from the plan: some meter readings were missing for this session.'}
        </Text>
      </Section>

      <Section label="What that means">
        <Text style={type.body}>{co2Equivalent(report.avoidedCo2Kg)}</Text>
        <Text style={[type.caption, { marginTop: theme.space(2) }]}>
          {kwh(report.energyKwh)} delivered for {money(report.cost)}, {percent(report.renewableShare)} renewable.
        </Text>
      </Section>

      <View style={{ marginTop: theme.space(6) }}>
        <Button title="Done" onPress={onDone} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroCopy: { paddingHorizontal: theme.space(5), paddingTop: theme.space(5), gap: theme.space(2) },
  band: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space(4) },
  score: { fontFamily: type.figure.fontFamily, fontSize: 64, lineHeight: 80, color: theme.lime },
  scoreLabel: { ...type.caption, color: theme.onForestMuted },
  bandSide: { alignItems: 'flex-end', gap: theme.space(2) },
  figures: { flexDirection: 'row', gap: theme.space(4), marginTop: theme.space(1) },
  compare: { gap: 2 },
  baseline: { ...type.caption, textDecorationLine: 'line-through', color: theme.pebble },
});
