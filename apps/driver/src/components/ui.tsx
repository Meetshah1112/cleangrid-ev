import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { fonts, theme, type } from '../theme';
import { Icon } from './Icon';

/**
 * The pieces every screen is built from, in the console's language: open sections on paper rather
 * than stacks of cards, a serif for headlines and figures, a forest band where a promise is stated,
 * and a mist panel only where controls need grouping.
 */

export function Screen({ children, hero }: { children: ReactNode; hero?: ReactNode }) {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      {hero}
      <View style={styles.page}>{children}</View>
      <View style={{ height: theme.space(8) }} />
    </ScrollView>
  );
}

export function PageHead({ eyebrow, title, lede }: { eyebrow: string; title: string; lede?: string }) {
  return (
    <View style={styles.head}>
      <Text style={type.eyebrow}>{eyebrow}</Text>
      <Text style={[type.display, styles.headTitle]} accessibilityRole="header" textBreakStrategy="balanced">
        {title}
      </Text>
      {lede ? <Text style={[type.body, styles.headLede]}>{lede}</Text> : null}
    </View>
  );
}

/** A labelled stretch of the page, set off from the one above by a rule and space, not a box. */
export function Section({ label, aside, children, first }: { label?: string; aside?: ReactNode; children: ReactNode; first?: boolean }) {
  return (
    <View style={[styles.section, first && styles.sectionFirst]}>
      {label || aside ? (
        <View style={styles.sectionHead}>
          {label ? <Text style={type.eyebrow}>{label}</Text> : <View />}
          {aside}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A soft ground for controls that belong together. */
export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

/** The forest band where the app states what it is promising, the way the console states its proof. */
export function ForestBand({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.band, style]}>{children}</View>;
}

/** A figure and what it counts, serif over grotesk. */
export function Figure({
  value,
  label,
  onForest,
  accent,
  size = 'normal',
}: {
  value: string;
  label: string;
  onForest?: boolean;
  accent?: string;
  size?: 'small' | 'normal' | 'large';
}) {
  return (
    <View style={styles.figure}>
      <Text
        style={[
          type.figure,
          size === 'large' && styles.figureLarge,
          size === 'small' && styles.figureSmall,
          onForest && { color: theme.onForest },
          accent ? { color: accent } : null,
        ]}
      >
        {value}
      </Text>
      <Text style={[type.caption, onForest && { color: theme.onForestMuted }]}>{label}</Text>
    </View>
  );
}

export function Notice({ children, tone = 'warn' }: { children: ReactNode; tone?: 'calm' | 'warn' | 'risk' }) {
  const map = {
    calm: { bg: theme.mist, fg: theme.forest },
    warn: { bg: theme.sunSoft, fg: theme.sunInk },
    risk: { bg: theme.coralSoft, fg: theme.coralInk },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: map.bg }]} accessibilityRole={tone === 'risk' ? 'alert' : undefined}>
      <Text style={[type.caption, { color: map.fg, fontSize: 13.5 }]}>{children}</Text>
    </View>
  );
}

/** Status in words, with colour as support rather than the message. */
export function Status({ children, tone = 'good' }: { children: ReactNode; tone?: 'good' | 'risk' | 'warn' | 'quiet' | 'onForest' }) {
  const map = {
    good: { bg: theme.canopySoft, fg: theme.canopyInk },
    risk: { bg: theme.coralSoft, fg: theme.coralInk },
    warn: { bg: theme.sunSoft, fg: theme.sunInk },
    quiet: { bg: theme.mist, fg: theme.forest },
    onForest: { bg: 'rgba(185,227,107,0.16)', fg: theme.lime },
  }[tone];
  return (
    <View style={[styles.status, { backgroundColor: map.bg }]}>
      <Text style={[styles.statusText, { color: map.fg }]}>{children}</Text>
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
  tone?: 'primary' | 'quiet' | 'danger' | 'light';
  disabled?: boolean;
}) {
  const ground = { primary: styles.primary, quiet: styles.quiet, danger: styles.danger, light: styles.light }[tone];
  const ink = { primary: styles.primaryText, quiet: styles.quietText, danger: styles.dangerText, light: styles.lightText }[tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled === true }}
      style={({ pressed }) => [styles.button, ground, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, ink]}>{title}</Text>
    </Pressable>
  );
}

export function TextLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
}

/** Figures in a row, the way the live screen shows added, power and time left. */
export function FactRow({ facts, onForest }: { facts: { value: string; label: string }[]; onForest?: boolean }) {
  return (
    <View style={styles.factRow}>
      {facts.map((fact) => (
        <View key={fact.label} style={styles.fact}>
          <Text style={[styles.factValue, onForest && { color: theme.onForest }]}>{fact.value}</Text>
          <Text style={[type.caption, onForest && { color: theme.onForestMuted }]}>{fact.label}</Text>
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
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  step: number;
  min: number;
  max: number;
  format: (value: number) => string;
  /** Names what is being adjusted, for the screen reader: "More energy". */
  label?: string;
}) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={styles.stepper} accessibilityRole="adjustable" accessibilityValue={{ text: format(value) }}>
      <Pressable
        style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, atMin && styles.disabled]}
        onPress={() => onChange(Math.max(min, value - step))}
        disabled={atMin}
        accessibilityRole="button"
        accessibilityLabel={label ? `Less ${label}` : 'Less'}
        accessibilityState={{ disabled: atMin }}
      >
        <Icon name="minus" size={20} color={theme.forest} />
      </Pressable>
      <Text style={styles.stepValue}>{format(value)}</Text>
      <Pressable
        style={({ pressed }) => [styles.stepButton, pressed && styles.pressed, atMax && styles.disabled]}
        onPress={() => onChange(Math.min(max, value + step))}
        disabled={atMax}
        accessibilityRole="button"
        accessibilityLabel={label ? `More ${label}` : 'More'}
        accessibilityState={{ disabled: atMax }}
      >
        <Icon name="plus" size={20} color={theme.forest} />
      </Pressable>
    </View>
  );
}

/** How far along something is: a fill with no track behind it, so the number beside it carries the comparison. */
export function Line({ value, tone = theme.canopy }: { value: number; tone?: string }) {
  return (
    <View style={styles.lineBox}>
      <View style={[styles.lineFill, { width: `${Math.max(2, Math.min(1, value) * 100)}%`, backgroundColor: tone }]} />
    </View>
  );
}

/** The charge so far as an arc with no track, around the figure it belongs to. */
export function Arc({ value, size = 150, children }: { value: number; size?: number; children?: ReactNode }) {
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0.01, Math.min(1, value)) * circumference;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
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
      {children}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

/** A tappable row, for bays, sites and preferences. */
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
      accessibilityRole="radio"
      accessibilityLabel={[title, subtitle, trailing].filter(Boolean).join(', ')}
      accessibilityState={{ selected: selected === true, disabled: disabled === true }}
      style={({ pressed }) => [styles.choice, selected && styles.choiceOn, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.choiceTitle, selected && { color: theme.canopyInk }]}>{title}</Text>
        {subtitle ? <Text style={[type.caption, { marginTop: 1 }]}>{subtitle}</Text> : null}
      </View>
      {trailing ? <Text style={[styles.choiceTrailing, selected && { color: theme.canopyInk }]}>{trailing}</Text> : null}
    </Pressable>
  );
}

export type Tab = 'home' | 'plan' | 'history' | 'profile';

const TABS = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'plan', label: 'Plan', icon: 'plan' },
  { key: 'history', label: 'History', icon: 'history' },
  { key: 'profile', label: 'Profile', icon: 'profile' },
] as const;

export function TabBar({ current, onChange }: { current: Tab; onChange: (tab: Tab) => void }) {
  return (
    <View style={styles.tabbar} accessibilityRole="tablist">
      {TABS.map((tab) => {
        const active = tab.key === current;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
          >
            <Icon name={tab.icon} size={22} color={active ? theme.forest : theme.pebble} />
            <Text style={[styles.tabLabel, active && styles.tabActive]}>{tab.label}</Text>
            <View style={[styles.tabMark, active && styles.tabMarkOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.paper },
  screenContent: { flexGrow: 1, backgroundColor: theme.paper },
  page: { paddingHorizontal: theme.space(5), paddingTop: theme.space(5) },
  head: { marginBottom: theme.space(2) },
  headTitle: { marginTop: theme.space(2) },
  headLede: { marginTop: theme.space(2), color: theme.stone },
  section: { marginTop: theme.space(7) },
  sectionFirst: { marginTop: theme.space(2) },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.space(3), gap: theme.space(2) },
  panel: { backgroundColor: theme.mist, borderRadius: theme.radiusPanel, padding: theme.space(4) },
  band: { backgroundColor: theme.forestDeep, paddingHorizontal: theme.space(5), paddingVertical: theme.space(5) },
  figure: { flex: 1, gap: 2 },
  figureLarge: { fontSize: 44, lineHeight: 58 },
  figureSmall: { fontSize: 22, lineHeight: 30 },
  notice: { borderRadius: theme.radiusControl, paddingVertical: theme.space(3), paddingHorizontal: theme.space(4), marginBottom: theme.space(3) },
  status: { alignSelf: 'flex-start', borderRadius: theme.radiusPill, paddingVertical: 5, paddingHorizontal: 11 },
  statusText: { fontFamily: fonts.sansSemiBold, fontSize: 12.5 },
  button: { minHeight: 52, paddingHorizontal: theme.space(5), borderRadius: theme.radiusControl, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: fonts.sansSemiBold, fontSize: 16 },
  primary: { backgroundColor: theme.forest },
  primaryText: { color: theme.paper },
  quiet: { backgroundColor: theme.mist },
  quietText: { color: theme.forest },
  danger: { backgroundColor: theme.coralSoft },
  dangerText: { color: theme.coralInk },
  light: { backgroundColor: 'rgba(252,253,251,0.92)' },
  lightText: { color: theme.forest },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
  link: { alignSelf: 'center', paddingVertical: theme.space(3), paddingHorizontal: theme.space(4) },
  linkText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: theme.forest, textDecorationLine: 'underline' },
  factRow: { flexDirection: 'row', gap: theme.space(3) },
  fact: { flex: 1, gap: 1 },
  factValue: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 30, color: theme.forest },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.mist,
    borderRadius: theme.radiusPill,
    padding: theme.space(1),
  },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { fontFamily: fonts.serif, fontSize: 24, lineHeight: 32, color: theme.forest },
  lineBox: { height: 3, width: '100%' },
  lineFill: { height: 3, borderRadius: 3 },
  divider: { height: 1, backgroundColor: theme.rule, marginVertical: theme.space(3) },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(4),
    paddingHorizontal: theme.space(3),
    borderRadius: theme.radiusControl,
    borderBottomWidth: 1,
    borderBottomColor: theme.rule,
  },
  choiceOn: { backgroundColor: theme.canopySoft, borderBottomColor: 'transparent' },
  choiceTitle: { fontFamily: fonts.sansSemiBold, fontSize: 16, color: theme.forest },
  choiceTrailing: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: theme.stone },
  tabbar: {
    flexDirection: 'row',
    backgroundColor: theme.paper,
    borderTopWidth: 1,
    borderTopColor: theme.rule,
    paddingTop: theme.space(2),
    paddingBottom: theme.space(4),
  },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 2, borderRadius: theme.radiusControl },
  tabPressed: { backgroundColor: theme.mist },
  tabLabel: { fontFamily: fonts.sans, fontSize: 11.5, color: theme.pebble },
  tabActive: { fontFamily: fonts.sansSemiBold, color: theme.forest },
  tabMark: { width: 18, height: 2, borderRadius: 2, marginTop: 3, backgroundColor: 'transparent' },
  tabMarkOn: { backgroundColor: theme.forest },
});
