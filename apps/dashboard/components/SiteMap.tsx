'use client';

import { useMemo, useState } from 'react';
import type { Charger, Session } from '../lib/types';

/**
 * The bays as they sit on the ground, not as a list.
 *
 * An operator standing in the car park thinks in positions: which row, which end, where the queue
 * is building. A table cannot answer "is the far row idle while the entrance is full", and that is
 * the question a plaza map exists for. Positions come from the charger order, laid out in two rows
 * either side of an access lane, which is how a car park of this size is actually striped.
 */

type Status = 'charging' | 'waiting' | 'free' | 'offline' | 'risk';

interface Pin {
  readonly id: string;
  readonly label: string;
  readonly fullLabel: string;
  readonly x: number;
  readonly y: number;
  readonly status: Status;
  readonly driver: string | null;
  readonly powerKw: number;
  readonly maxPowerKw: number;
}

const WIDTH = 760;
const HEIGHT = 250;
const LANE_Y = HEIGHT / 2;

/** Bays are 44px wide on the map, so only the identifying digits fit; the rest goes to the readout. */
function shortLabel(label: string): string {
  const digits = label.match(/\d+/);
  if (digits) return digits[0];
  return label.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}

const STATUS_FILL: Record<Status, string> = {
  charging: 'var(--green)',
  waiting: 'var(--green-bright)',
  risk: 'var(--amber)',
  free: 'var(--card)',
  offline: 'var(--line)',
};

function statusOf(charger: Charger, session: Session | undefined): Status {
  if (!charger.online) return 'offline';
  if (!session) return 'free';
  if (session.deadlineRisk) return 'risk';
  return session.currentPowerKw > 0.05 ? 'charging' : 'waiting';
}

export function SiteMap({
  chargers,
  sessions,
  siteName,
}: {
  readonly chargers: Charger[];
  readonly sessions: Session[];
  readonly siteName: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const pins = useMemo<Pin[]>(() => {
    const active = new Map(
      sessions.filter((session) => session.status === 'active' || session.status === 'pending').map((s) => [s.chargerId, s]),
    );
    const ordered = [...chargers].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const perRow = Math.ceil(ordered.length / 2);
    const stride = (WIDTH - 120) / Math.max(1, perRow - 1 || 1);

    return ordered.map((charger, index) => {
      const row = index < perRow ? 0 : 1;
      const column = index < perRow ? index : index - perRow;
      const session = active.get(charger.id);
      return {
        id: charger.id,
        label: shortLabel(charger.label),
        fullLabel: charger.label,
        x: 60 + column * stride,
        y: row === 0 ? LANE_Y - 58 : LANE_Y + 58,
        status: statusOf(charger, session),
        driver: session?.driverName ?? null,
        powerKw: session?.currentPowerKw ?? 0,
        maxPowerKw: charger.maxPowerKw,
      };
    });
  }, [chargers, sessions]);

  const counts = pins.reduce<Record<Status, number>>(
    (total, pin) => ({ ...total, [pin.status]: (total[pin.status] ?? 0) + 1 }),
    { charging: 0, waiting: 0, free: 0, offline: 0, risk: 0 },
  );
  const shown = pins.find((pin) => pin.id === hovered) ?? null;

  return (
    <div className="plaza">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Charger positions at ${siteName}`}>
        {/* The tarmac, its access lane, and the bay stripes each car is parked between. */}
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="14" className="plaza-ground" />
        <rect x="18" y={LANE_Y - 20} width={WIDTH - 36} height="40" rx="8" className="plaza-lane" />
        {pins.map((pin) => (
          <g key={`stripe-${pin.id}`} className="plaza-stripe">
            <line x1={pin.x - 26} y1={pin.y - 26} x2={pin.x - 26} y2={pin.y + 26} />
            <line x1={pin.x + 26} y1={pin.y - 26} x2={pin.x + 26} y2={pin.y + 26} />
          </g>
        ))}

        {pins.map((pin) => (
          <g
            key={pin.id}
            className={`plaza-bay is-${pin.status}${hovered === pin.id ? ' is-hovered' : ''}`}
            onMouseEnter={() => setHovered(pin.id)}
            onMouseLeave={() => setHovered((current) => (current === pin.id ? null : current))}
            tabIndex={0}
            role="button"
            aria-label={`${pin.fullLabel}: ${pin.status}${pin.driver ? `, ${pin.driver}` : ''}`}
            onFocus={() => setHovered(pin.id)}
            onBlur={() => setHovered((current) => (current === pin.id ? null : current))}
          >
            <rect x={pin.x - 22} y={pin.y - 23} width="44" height="46" rx="9" fill={STATUS_FILL[pin.status]} />
            <text x={pin.x} y={pin.y + 5} className="plaza-label">
              {pin.label}
            </text>
            {pin.status === 'charging' ? (
              <circle cx={pin.x + 16} cy={pin.y - 17} r="4" className="plaza-live" />
            ) : null}
          </g>
        ))}
      </svg>

      <div className="plaza-foot">
        <span className="plaza-key">
          <i style={{ background: 'var(--green)' }} />
          Charging {counts.charging}
        </span>
        <span className="plaza-key">
          <i style={{ background: 'var(--green-bright)' }} />
          Holding {counts.waiting}
        </span>
        <span className="plaza-key">
          <i style={{ background: 'var(--card)', borderColor: 'var(--line)' }} />
          Free {counts.free}
        </span>
        {counts.risk > 0 ? (
          <span className="plaza-key">
            <i style={{ background: 'var(--amber)' }} />
            At risk {counts.risk}
          </span>
        ) : null}
        {counts.offline > 0 ? (
          <span className="plaza-key">
            <i style={{ background: 'var(--line)' }} />
            Offline {counts.offline}
          </span>
        ) : null}
        <span className="plaza-readout">
          {shown
            ? `${shown.fullLabel} · ${shown.driver ?? 'no car'} · ${shown.powerKw.toFixed(1)} of ${shown.maxPowerKw} kW`
            : 'Point at a bay for its driver and current draw'}
        </span>
      </div>
    </div>
  );
}
