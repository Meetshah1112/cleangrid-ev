import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { carbonColor, theme } from '../theme';
import { clockTime } from '../format';

/** Small shared pieces: cards, steppers, the carbon ribbon and the planned-power timeline. */

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  tone = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  tone?: 'primary' | 'quiet' | 'danger';
  disabled?: boolean;
}) {
  const toneStyle = tone === 'primary' ? styles.primary : tone === 'danger' ? styles.danger : styles.quiet;
  const textStyle = tone === 'primary' ? styles.primaryText : tone === 'danger' ? styles.dangerText : styles.quietText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, toneStyle, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, textStyle]}>{title}</Text>
    </Pressable>
  );
}

export function Stepper({
  value,
  onChange,
  step,
  min,
  max,
  format,
}: {
  value: number;
  onChange: (next: number) => void;
  step: number;
  min: number;
  max: number;
  format: (value: number) => string;
}) {
  return (
    <View style={styles.stepper}>
      <Pressable
        style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
        onPress={() => onChange(Math.max(min, value - step))}
      >
        <Text style={styles.stepSign}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{format(value)}</Text>
      <Pressable
        style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
        onPress={() => onChange(Math.min(max, value + step))}
      >
        <Text style={styles.stepSign}>+</Text>
      </Pressable>
    </View>
  );
}

/** The next 24 hours, coloured by how clean the grid will be. */
export function CarbonRibbon({
  carbon,
  startMs,
  stepMinutes,
  markers = 4,
}: {
  carbon: number[];
  startMs: number;
  stepMinutes: number;
  markers?: number;
}) {
  if (carbon.length === 0) return null;
  const every = Math.max(1, Math.floor(carbon.length / markers));
  return (
    <View>
      <View style={styles.ribbon}>
        {carbon.map((value, index) => (
          <View key={index} style={[styles.ribbonCell, { backgroundColor: carbonColor(value) }]} />
        ))}
      </View>
      <View style={styles.ribbonAxis}>
        {carbon
          .map((_, index) => index)
          .filter((index) => index % every === 0)
          .map((index) => (
            <Text key={index} style={styles.axisText}>
              {clockTime(startMs + index * stepMinutes * 60_000)}
            </Text>
          ))}
      </View>
    </View>
  );
}

/** Planned power per slot, drawn over the carbon colours so the pauses explain themselves. */
export function PlanTimeline({
  plannedKw,
  carbon,
  maxPowerKw,
}: {
  plannedKw: number[];
  carbon: number[];
  maxPowerKw: number;
}) {
  if (plannedKw.length === 0) return null;
  return (
    <View style={styles.timeline}>
      {plannedKw.map((kw, index) => {
        const height = maxPowerKw > 0 ? Math.max(2, (kw / maxPowerKw) * 46) : 2;
        const tint = carbonColor(carbon[index] ?? 300);
        return (
          <View key={index} style={styles.timelineColumn}>
            <View style={[styles.timelineBar, { height, backgroundColor: kw > 0 ? tint : theme.line }]} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderRadius: theme.radius,
    padding: theme.space(4),
    borderWidth: 1,
    borderColor: theme.line,
    marginBottom: theme.space(3),
  },
  label: {
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: theme.faint,
    marginBottom: theme.space(1),
    fontWeight: '600',
  },
  button: {
    paddingVertical: theme.space(3.5),
    paddingHorizontal: theme.space(5),
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  primary: { backgroundColor: theme.accent },
  primaryText: { color: '#ffffff' },
  quiet: { backgroundColor: theme.accentSoft },
  quietText: { color: theme.accent },
  danger: { backgroundColor: '#fdeceb' },
  dangerText: { color: theme.red },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.bg,
    borderRadius: 12,
    padding: theme.space(1),
  },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.line,
  },
  stepSign: { fontSize: 22, color: theme.accent, fontWeight: '600' },
  stepValue: { fontSize: 20, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  ribbon: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' },
  ribbonCell: { flex: 1, height: '100%' },
  ribbonAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space(1) },
  axisText: { fontSize: 10, color: theme.faint },
  timeline: { flexDirection: 'row', alignItems: 'flex-end', height: 50, gap: 1 },
  timelineColumn: { flex: 1, justifyContent: 'flex-end', height: '100%' },
  timelineBar: { width: '100%', borderRadius: 2 },
});
