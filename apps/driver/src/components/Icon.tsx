import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * The app's icons, drawn rather than borrowed from the Unicode table.
 *
 * Glyphs like ⌂ and ◷ inherit the text font, so they change shape between Android versions, refuse
 * to sit on the baseline, and carry none of the stroke weight of the rest of the interface. These
 * are one family: a 24px box, 1.8px stroke, round caps, and whatever colour they are given.
 */

export type IconName =
  | 'home'
  | 'plan'
  | 'history'
  | 'profile'
  | 'cheapest'
  | 'greenest'
  | 'fastest'
  | 'balanced'
  | 'minus'
  | 'plus';

const STROKE = 1.8;

/** Filled icons read as a different hierarchy level, so the set keeps them deliberate and few. */
const FILLED: ReadonlySet<IconName> = new Set(['fastest']);

function paths(name: IconName) {
  switch (name) {
    case 'home':
      return (
        <>
          <Path d="M3.5 10.6 12 3.8l8.5 6.8" />
          <Path d="M5.5 9.4V20h13V9.4" />
          <Path d="M9.8 20v-5.6h4.4V20" />
        </>
      );
    // The plan is a schedule: blocks of different length down the day.
    case 'plan':
      return (
        <>
          <Path d="M4 7.5h10" />
          <Path d="M4 12h16" />
          <Path d="M4 16.5h6.5" />
        </>
      );
    case 'history':
      return (
        <>
          <Circle cx="12" cy="12" r="8.4" />
          <Path d="M12 7.1V12l3.3 2" />
        </>
      );
    case 'profile':
      return (
        <>
          <Circle cx="12" cy="8.6" r="3.7" />
          <Path d="M5.2 19.6a6.9 6.9 0 0 1 13.6 0" />
        </>
      );
    // Cost, without committing to a currency sign: a price tag.
    case 'cheapest':
      return (
        <>
          <Path d="M11.4 3.6H20v8.6l-8.4 8.4a1.6 1.6 0 0 1-2.3 0l-6.3-6.3a1.6 1.6 0 0 1 0-2.3z" />
          <Circle cx="16.2" cy="7.8" r="1.5" />
        </>
      );
    // Clean power: a leaf.
    case 'greenest':
      return (
        <>
          <Path d="M20 4.2c0 8.4-4.6 13-11.4 13H5.2C5.2 9.6 10.4 4.2 20 4.2Z" />
          <Path d="M5.2 20c1.4-4.6 4.2-7.7 8.2-9.4" />
        </>
      );
    case 'fastest':
      return <Path d="M13 2 5 13.6h5.7L9.9 22 19 10h-5.9z" />;
    // A mix of the two: a circle half filled.
    case 'balanced':
      return (
        <>
          <Circle cx="12" cy="12" r="8.4" />
          <Path d="M12 3.6a8.4 8.4 0 0 1 0 16.8z" fill="currentColor" stroke="none" />
        </>
      );
    case 'minus':
      return <Path d="M6 12h12" />;
    case 'plus':
      return (
        <>
          <Path d="M12 6v12" />
          <Path d="M6 12h12" />
        </>
      );
    default:
      return <Rect x="4" y="4" width="16" height="16" rx="3" />;
  }
}

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  const filled = FILLED.has(name);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={filled ? 'none' : color}
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      color={color}
    >
      {paths(name)}
    </Svg>
  );
}
