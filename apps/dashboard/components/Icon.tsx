/**
 * The console's icons, drawn rather than borrowed from the Unicode table.
 *
 * Glyphs like ▦ and ∿ inherit the text font, so they change shape between machines, refuse to align
 * on the baseline, and carry none of the stroke weight of the rest of the interface. These are one
 * family: 24px box, 1.6px stroke, round caps, currentColor.
 */

export type IconName =
  | 'overview'
  | 'forecast'
  | 'schedules'
  | 'flex'
  | 'impact'
  | 'chevron'
  | 'pin'
  | 'bolt'
  | 'check'
  | 'alert'
  | 'clock'
  | 'leaf'
  | 'sun'
  | 'wind'
  | 'moon'
  | 'arrow';

const PATHS: Record<IconName, React.ReactNode> = {
  // A site plan: one wide bay and two stacked ones.
  overview: (
    <>
      <rect x="3" y="3" width="8" height="18" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </>
  ),
  // A demand curve with its peak marked.
  forecast: (
    <>
      <path d="M3 15c2.4 0 3.2-7 5.4-7s3 9 5.4 9 2.6-6 4.8-6" />
      <path d="M20.5 8.5v3" />
    </>
  ),
  // Stacked schedule blocks of different lengths.
  schedules: (
    <>
      <path d="M4 7h11" />
      <path d="M4 12h16" />
      <path d="M4 17h7" />
    </>
  ),
  // Grid flexibility: a bolt.
  flex: <path d="M13 2 5 13.5h5.6L9.8 22 19 10h-5.8z" />,
  // Measured impact: a target with a reading.
  impact: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  chevron: <path d="m6 9.5 6 6 6-6" />,
  pin: (
    <>
      <path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  bolt: <path d="M13 2 5 13.5h5.6L9.8 22 19 10h-5.8z" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  alert: (
    <>
      <path d="M12 3.5 21 20H3z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.2v.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  // Renewable: a leaf with its vein.
  leaf: (
    <>
      <path d="M5 19c0-8.2 5.6-13.6 14-14-.3 8.4-5.7 14-14 14" />
      <path d="M5.5 18.5c3-3.6 6.2-6.4 9.8-8.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  wind: (
    <>
      <path d="M3 9h11a3 3 0 1 0-3-3" />
      <path d="M3 14h15a3 3 0 1 1-3 3" />
    </>
  ),
  moon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />,
  arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
};

const FILLED: ReadonlySet<IconName> = new Set(['flex', 'bolt']);

export function Icon({ name, size = 18 }: { readonly name: IconName; readonly size?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
