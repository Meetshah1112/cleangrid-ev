import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChargingMode, ModePreview } from '../api';
import { clockTime, money, percent } from '../format';
import { MODE_COLOUR, MODE_COPY, fonts, theme, type } from '../theme';
import { Icon, type IconName } from './Icon';

const ORDER: ChargingMode[] = ['greenest', 'cheapest', 'balanced', 'fastest'];

/**
 * The four modes as a two-by-two grid. Each carries the estimate from the same scheduler that will
 * run the session, so the preview and the outcome cannot drift apart. The chosen one turns forest,
 * the way a pressed choice does in the console.
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
        const ink = selected ? theme.paper : theme.forest;
        const soft = selected ? 'rgba(252,253,251,0.72)' : theme.stone;
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
            <View style={styles.cellHead}>
              <Icon name={key as IconName} size={18} color={selected ? theme.lime : (MODE_COLOUR[key] ?? theme.forest)} />
              <Text style={[styles.cellTitle, { color: ink }]}>{copy?.title}</Text>
            </View>
            <Text style={[type.caption, { color: soft, fontSize: 12 }]}>{copy?.blurb}</Text>
            {preview ? (
              <>
                <Text style={[styles.cellCost, { color: ink }]}>{money(preview.cost)}</Text>
                <Text style={[styles.cellFacts, { color: soft }]}>
                  {preview.co2Kg.toFixed(1)} kg, {percent(preview.renewableShare)} clean
                </Text>
                <Text style={[styles.cellFacts, { color: soft }]}>{preview.finishByMs ? `done by ${clockTime(preview.finishByMs)}` : 'will not finish'}</Text>
                {preview.shortfallKwh > 0.1 ? (
                  <Text style={[styles.shortfall, selected && { color: '#ffbfae' }]}>{preview.shortfallKwh.toFixed(1)} kWh short</Text>
                ) : null}
              </>
            ) : (
              <Text style={[styles.cellFacts, { color: soft, marginTop: theme.space(3) }]}>Estimating</Text>
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
    backgroundColor: theme.mist,
    borderRadius: theme.radiusPanel - 6,
    padding: theme.space(4),
    marginBottom: theme.space(3),
    gap: 2,
  },
  cellOn: { backgroundColor: theme.forest },
  // Opacity only: a transform here would shift the neighbouring cards on every tap.
  cellPressed: { opacity: 0.75 },
  cellHead: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2), marginBottom: 2 },
  cellTitle: { fontFamily: fonts.sansSemiBold, fontSize: 15.5 },
  cellCost: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 30, marginTop: theme.space(2) },
  cellFacts: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  shortfall: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: theme.coralInk, marginTop: 2 },
});
