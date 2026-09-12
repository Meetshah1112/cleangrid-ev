import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { carbonColor, theme } from '../theme';
import { clockTime } from '../format';

/** The shared pieces every screen is built from. */

export function Screen({ children, tint }: { children: ReactNode; tint?: string }) {
  return (
    <ScrollView
      style={{ backgroundColor: tint ?? theme.bg }}
      contentContainerStyle={[styles.page, tint ? { backgroundColor: tint } : null]}
    >
      {children}
      <View style={{ height: theme.space(8) }} />
    </ScrollView>
  );
}

export function ScreenHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function DeepCard({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[styles.deepCard, style]}>{children}</View>;
}

export function Label({ children, onDeep }: { children: ReactNode; onDeep?: boolean }) {
  return <Text style={[styles.label, onDeep ? { color: theme.mutedOnDeep } : null]}>{children}</Text>;
}

export function Chip({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' | 'red' | 'lime' }) {
  const map = {
    green: { bg: theme.greenSoft, fg: '#14603f' },
    amber: { bg: theme.amberSoft, fg: '#7d5610' },
    red: { bg: theme.redSoft, fg: '#8d2b20' },
    lime: { bg: 'rgba(184,233,134,0.18)', fg: theme.lime },
  }[tone];
  return (
    <View style={[styles.chip, { backgroundColor: map.bg }]}>
      <Text style={[styles.chipText, { color: map.fg }]}>{children}</Text>
    </View>
  );
}

export function Notice({ children, tone = 'amber' }: { children: ReactNode; tone?: 'amber' | 'red' }) {
  const map = { amber: { bg: theme.amberSoft, fg: '#7a5410' }, red: { bg: theme.redSoft, fg: '#8d2b20' } }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: map.bg }]}>
      <Text style={[styles.noticeText, { color: map.fg }]}>{children}</Text>
    </View>
  );
}

export function Button({
  title,
  onPress,
  tone = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  tone?: 'primary' | 'quiet' | 'danger' | 'deep';
  disabled?: boolean;
}) {
  const toneStyle =
    tone === 'primary'
      ? styles.primary
      : tone === 'danger'
        ? styles.danger
        : tone === 'deep'
          ? styles.deepBtn
          : styles.quiet;
  const textStyle =
    tone === 'primary' || tone === 'deep' ? styles.primaryText : tone === 'danger' ? styles.dangerText : styles.quietText;
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

export function TextLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [pressed && styles.pressed, styles.link]}>
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
}

export function StatTile({
  value,
  label,
  onDeep,
  accent,
}: {
  value: string;
  label: string;
  onDeep?: boolean;
  accent?: string;
}) {
  return (
    <View style={[styles.tile, onDeep && styles.tileOnDeep]}>
      <Text style={[styles.tileValue, onDeep ? { color: theme.inkOnDeep } : null, accent ? { color: accent } : null]}>
        {value}
      </Text>
      <Text style={[styles.tileLabel, onDeep ? { color: theme.mutedOnDeep } : null]}>{label}</Text>
    </View>
  );
}

/** Three numbers in a row, the way the live screen shows added / power / time left. */
export function FactRow({ facts }: { facts: { value: string; label: string }[] }) {
  return (
    <View style={styles.factRow}>
      {facts.map((fact) => (
        <View key={fact.label} style={styles.fact}>
          <Text style={styles.factLabel}>{fact.label}</Text>
          <Text style={styles.factValue}>{fact.value}</Text>
        </View>
      ))}
    </View>
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

/** The abstract EV in the home hero. Not a photo of a car, a shape that reads as one. */
export function CarGlyph({ height = 120 }: { height?: number }) {
  return (
    <Svg width="100%" height={height} viewBox="0 0 240 108" preserveAspectRatio="xMidYMid meet">
      <Path d="M62 54 L84 20 C89 12 97 8 107 8 L150 8 C161 8 170 14 174 24 L186 54 Z" fill={theme.limeDim} />
      <Rect x={6} y={48} width={228} height={52} rx={26} fill={theme.lime} />
      <Path d="M6 74 L234 48 L234 74 Z" fill="rgba(255,255,255,0.2)" />
      <Circle cx={62} cy={100} r={9} fill={theme.deep} opacity={0.35} />
      <Circle cx={182} cy={100} r={9} fill={theme.deep} opacity={0.35} />
    </Svg>
  );
}

/** A day of grid carbon as a colour strip, with the chosen window boxed. */
export function CarbonStrip({
  carbon,
  startMs,
  stepMinutes,
  highlightFrom,
  highlightTo,
  height = 26,
}: {
  carbon: number[];
  startMs: number;
  stepMinutes: number;
  highlightFrom?: number | null;
  highlightTo?: number | null;
  height?: number;
}) {
  if (carbon.length === 0) return null;
  const width = 320;
  const cell = width / carbon.length;
  const from = highlightFrom == null ? null : ((highlightFrom - startMs) / (stepMinutes * 60_000)) * cell;
  const to = highlightTo == null ? null : ((highlightTo - startMs) / (stepMinutes * 60_000)) * cell;

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {carbon.map((value, index) => (
          <Rect key={index} x={index * cell} y={0} width={cell + 0.5} height={height} fill={carbonColor(value)} />
        ))}
        {from != null && to != null && to > from && (
          <Rect
            x={Math.max(0, from)}
            y={1}
            width={Math.max(4, Math.min(width, to) - Math.max(0, from))}
            height={height - 2}
            fill="none"
            stroke={theme.deep}
            strokeWidth={2.5}
            rx={6}
          />
        )}
      </Svg>
      <View style={styles.stripAxis}>
        {[0, Math.floor(carbon.length / 3), Math.floor((carbon.length * 2) / 3), carbon.length - 1].map((index) => (
          <Text key={index} style={styles.axisText}>
            {clockTime(startMs + index * stepMinutes * 60_000)}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** The charge ring on the live screen. */
export function Ring({ percent, caption, size = 172 }: { percent: number; caption: string; size?: number }) {
  const stroke = 15;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, percent)) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.14)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={theme.lime}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={styles.ringValue}>{Math.round(percent * 100)}%</Text>
      <Text style={styles.ringCaption}>{caption}</Text>
    </View>
  );
}

export function ProgressBar({ value, tone = theme.green }: { value: number; tone?: string }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: tone }]} />
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** A tappable row: used for bays, sites and vehicles. */
export function ChoiceRow({
  title,
  subtitle,
  trailing,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  subtitle?: string;
  trailing?: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceOn,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceTitle, selected ? { color: theme.green } : null]}>{title}</Text>
        {subtitle ? <Text style={styles.choiceSub}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={styles.choiceTrailing}>{trailing}</Text> : null}
    </Pressable>
  );
}

export type Tab = 'home' | 'plan' | 'history' | 'profile';

export function TabBar({ current, onChange }: { current: Tab; onChange: (tab: Tab) => void }) {
  const tabs = [
    { key: 'home', label: 'Home', glyph: '⌂' },
    { key: 'plan', label: 'Plan', glyph: '⌁' },
    { key: 'history', label: 'History', glyph: '◷' },
    { key: 'profile', label: 'Profile', glyph: '◉' },
  ] as const;

  return (
    <View style={styles.tabbar}>
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.tab}>
            <Text style={[styles.tabGlyph, active && styles.tabActive]}>{tab.glyph}</Text>
            <Text style={[styles.tabLabel, active && styles.tabActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: theme.space(5), paddingTop: theme.space(4), backgroundColor: theme.bg, flexGrow: 1 },
  header: { marginBottom: theme.space(5) },
  eyebrow: { fontSize: 13.5, color: theme.muted },
  title: { fontSize: 27, fontWeight: '700', color: theme.ink, letterSpacing: -0.6, marginTop: 2, lineHeight: 33 },
  subtitle: { fontSize: 14, color: theme.muted, marginTop: theme.space(2), lineHeight: 20 },
  card: {
    backgroundColor: theme.card,
    borderRadius: theme.radius,
    padding: theme.space(4),
    borderWidth: 1,
    borderColor: theme.line,
    marginBottom: theme.space(3),
  },
  deepCard: {
    backgroundColor: theme.deep,
    borderRadius: theme.radius,
    padding: theme.space(5),
    marginBottom: theme.space(3),
  },
  label: {
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: theme.faint,
    marginBottom: theme.space(2),
    fontWeight: '600',
  },
  chip: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11 },
  chipText: { fontSize: 12.5, fontWeight: '600' },
  notice: { borderRadius: 14, padding: theme.space(3), marginBottom: theme.space(3) },
  noticeText: { fontSize: 13, lineHeight: 18 },
  button: { paddingVertical: theme.space(4), paddingHorizontal: theme.space(5), borderRadius: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  primary: { backgroundColor: theme.green },
  deepBtn: { backgroundColor: theme.deep },
  primaryText: { color: '#ffffff' },
  quiet: { backgroundColor: theme.greenSoft },
  quietText: { color: '#14603f' },
  danger: { backgroundColor: theme.redSoft },
  dangerText: { color: theme.red },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  link: { alignSelf: 'center', paddingVertical: theme.space(3) },
  linkText: { color: theme.green, fontSize: 14.5, fontWeight: '600' },
  tile: {
    flex: 1,
    backgroundColor: theme.card,
    borderRadius: theme.radiusSmall,
    padding: theme.space(3),
    borderWidth: 1,
    borderColor: theme.line,
  },
  tileOnDeep: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'transparent' },
  tileValue: { fontSize: 20, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  tileLabel: { fontSize: 12, color: theme.muted, marginTop: 2 },
  factRow: { flexDirection: 'row' },
  fact: { flex: 1 },
  factLabel: { fontSize: 12, color: theme.muted },
  factValue: { fontSize: 17, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'], marginTop: 2 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.bg,
    borderRadius: 14,
    padding: theme.space(1),
  },
  stepButton: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.line,
  },
  stepSign: { fontSize: 22, color: theme.green, fontWeight: '600' },
  stepValue: { fontSize: 20, fontWeight: '700', color: theme.ink, fontVariant: ['tabular-nums'] },
  stripAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 10.5, color: theme.faint },
  ringValue: { fontSize: 32, fontWeight: '800', color: theme.inkOnDeep, fontVariant: ['tabular-nums'] },
  ringCaption: { fontSize: 12.5, color: theme.mutedOnDeep, marginTop: 2 },
  track: { height: 8, backgroundColor: theme.line, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  divider: { height: 1, backgroundColor: theme.line, marginVertical: theme.space(3) },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderRadius: theme.radiusSmall,
    borderWidth: 1.5,
    borderColor: theme.line,
    padding: theme.space(4),
    marginBottom: theme.space(2),
  },
  choiceOn: { borderColor: theme.green, backgroundColor: theme.greenSoft },
  choiceTitle: { fontSize: 16, fontWeight: '600', color: theme.ink },
  choiceSub: { fontSize: 12.5, color: theme.muted, marginTop: 2 },
  choiceTrailing: { fontSize: 13, color: theme.muted, fontVariant: ['tabular-nums'] },
  tabbar: {
    flexDirection: 'row',
    backgroundColor: theme.card,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingTop: theme.space(2),
    paddingBottom: theme.space(5),
  },
  tab: { flex: 1, alignItems: 'center' },
  tabGlyph: { fontSize: 17, color: theme.faint },
  tabLabel: { fontSize: 11, color: theme.faint, marginTop: 2 },
  tabActive: { color: theme.green, fontWeight: '700' },
});
