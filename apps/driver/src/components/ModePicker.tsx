import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChargingMode, ModePreview } from '../api';
import { clockTime, money, percent } from '../format';
import { MODE_COPY, theme } from '../theme';
import { Icon, type IconName } from './Icon';

const ORDER: ChargingMode[] = ['cheapest', 'greenest', 'fastest', 'balanced'];

/**
 * The four modes as a 2x2 grid. Each card carries the estimate from the same scheduler that will
 * run the session, so the preview and the outcome cannot drift apart.
 */
export function ModePicker({
  mode,
  onChange,
  previews,
}: {
  mode: ChargingMode;
  onChange: (next: ChargingMode) => void;
  previews: ModePreview[] | null;
}) {
  const byMode = new Map((previews ?? []).map((preview) => [preview.mode, preview]));

  return (
    <View style={styles.grid}>
      {ORDER.map((key) => {
        const copy = MODE_COPY[key];
        const preview = byMode.get(key);
        const selected = key === mode;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={
              preview
                ? `${copy?.title}: ${copy?.blurb}, ${money(preview.cost)}, ${preview.co2Kg.toFixed(1)} kilograms of CO2`
                : `${copy?.title}: ${copy?.blurb}, estimating`
            }
            style={({ pressed }) => [styles.cell, selected && styles.cellOn, pressed && styles.cellPressed]}
          >
            <View style={[styles.glyphWrap, selected && styles.glyphWrapOn]}>
              <Icon name={key as IconName} size={18} color={theme.green} />
            </View>
            <Text style={styles.cellTitle}>{copy?.title}</Text>
            <Text style={styles.cellBlurb}>{copy?.blurb}</Text>
            {preview ? (
              <>
                <Text style={styles.cellCost}>{money(preview.cost)}</Text>
                <Text style={styles.cellFacts}>
                  {preview.co2Kg.toFixed(1)} kg · {percent(preview.renewableShare)} clean
                </Text>
                <Text style={styles.cellFacts}>
                  {preview.finishByMs ? `done ${clockTime(preview.finishByMs)}` : 'will not finish'}
                </Text>
                {preview.shortfallKwh > 0.1 ? (
                  <Text style={styles.shortfall}>{preview.shortfallKwh.toFixed(1)} kWh short</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.cellFacts}>estimating…</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cell: {
    width: '48.5%',
    backgroundColor: theme.card,
    borderRadius: theme.radiusSmall,
    borderWidth: 1.5,
    borderColor: theme.line,
    padding: theme.space(3),
    marginBottom: theme.space(3),
  },
  cellOn: { borderColor: theme.green, backgroundColor: theme.greenSoft },
  // Opacity only: a transform here would shift the neighbouring cards on every tap.
  cellPressed: { opacity: 0.75 },
  glyphWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.space(2),
  },
  glyphWrapOn: { backgroundColor: '#ffffff' },
  cellTitle: { fontSize: 15.5, fontWeight: '700', color: theme.ink },
  cellBlurb: { fontSize: 12, color: theme.muted, marginTop: 1 },
  cellCost: { fontSize: 17, fontWeight: '700', color: theme.ink, marginTop: theme.space(2), fontVariant: ['tabular-nums'] },
  cellFacts: { fontSize: 11.5, color: theme.muted, marginTop: 1, fontVariant: ['tabular-nums'] },
  shortfall: { fontSize: 11.5, color: theme.red, marginTop: 2 },
});
