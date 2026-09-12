'use client';

import type { SceneGeometry } from '../scene/Scene';
import { BAY_STATE_LABEL, bayCounts, type Bay } from '../../lib/bays';
import { clockTime, kw, modeLabel } from '../../lib/format';

/**
 * The site's chargers, placed along the lane that curves through the foreground of the valley.
 *
 * Each charger is a moment on the road rather than a card in a grid, labelled directly in the
 * scene. Pointing at one, or focusing it with the keyboard, opens a small layer with the driver,
 * what the car is drawing, what it still needs, when it must leave, and the reason it is doing
 * what it is doing. Choosing it takes the operator to that session below.
 */

export interface LaneNode {
  readonly bay: Bay;
  readonly x: number;
  readonly y: number;
  /**
   * Where the detail opens. Above unless the point is too near the top for the layer to fit; inline
   * places it in the flow of the page, for screens too small for a layer not to cover something.
   */
  readonly placement?: 'above' | 'below' | 'inline';
}

export function laneLayout(bays: readonly Bay[], geometry: SceneGeometry) {
  const { width, height } = geometry;
  const narrow = width < 760;
  const laneY = (px: number): number => height * 0.885 - height * 0.032 * Math.sin((px / width) * Math.PI * 1.35 + 0.5);
  const from = narrow ? width * 0.08 : width * 0.36;
  const to = narrow ? width * 0.92 : width * 0.965;

  const points: string[] = [];
  for (let px = narrow ? 0 : width * 0.27; px <= width + 10; px += 10) points.push(`${px.toFixed(1)},${laneY(px).toFixed(1)}`);

  const nodes: LaneNode[] = bays.map((bay, index) => {
    const px = bays.length === 1 ? (from + to) / 2 : from + ((to - from) * index) / (bays.length - 1);
    return { bay, x: px, y: laneY(px) };
  });

  return { road: `M${points.join(' L')}`, nodes, narrow };
}

export function ChargerLaneLayer({
  layout,
  selected,
  onHover,
  onChoose,
}: {
  readonly layout: ReturnType<typeof laneLayout>;
  readonly selected: string | null;
  readonly onHover: (chargerId: string | null) => void;
  readonly onChoose: (bay: Bay) => void;
}) {
  const radius = layout.narrow ? 12 : 15;
  return (
    <g className="lane">
      <path d={layout.road} className="lane-road" />
      <path d={layout.road} className="lane-centre" />
      {layout.nodes.map(({ bay, x, y }) => (
        <g
          key={bay.charger.id}
          className={`lane-node is-${bay.state}${selected === bay.charger.id ? ' is-selected' : ''}`}
          transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
          tabIndex={0}
          role="button"
          aria-label={`Bay ${bay.number}, ${BAY_STATE_LABEL[bay.state]}. ${bay.why}`}
          onMouseEnter={() => onHover(bay.charger.id)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(bay.charger.id)}
          onBlur={() => onHover(null)}
          onClick={() => onChoose(bay)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onChoose(bay);
            }
          }}
        >
          {bay.state === 'charging' ? <line x1="0" y1={-radius - 2} x2="0" y2={-radius - 26} className="lane-flow" /> : null}
          <circle r={radius + 5} className="lane-hit" />
          <circle r={radius} className="lane-dot" />
          {bay.state === 'waiting' ? (
            <g className="lane-pause">
              <line x1="-3" y1="-4.5" x2="-3" y2="4.5" />
              <line x1="3" y1="-4.5" x2="3" y2="4.5" />
            </g>
          ) : bay.state === 'charged' ? (
            <path d="M-5 0.5 -1.5 4 5.5 -3.5" className="lane-check" />
          ) : (
            <text y="4.5" className="lane-number">
              {bay.number}
            </text>
          )}
          {!layout.narrow ? (
            <text y={radius + 18} className="lane-state">
              {bay.state === 'waiting' || bay.state === 'charged' ? `${bay.number} ${BAY_STATE_LABEL[bay.state]}` : BAY_STATE_LABEL[bay.state]}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}

/** The detail layer for the bay being pointed at, positioned over its node. */
export function LaneDetail({
  node,
  width,
  timezone,
}: {
  readonly node: LaneNode | null;
  readonly width: number;
  readonly timezone: string;
}) {
  if (!node) return null;
  const { bay } = node;
  const session = bay.session;
  const left = Math.min(Math.max(node.x, 150), width - 150);

  return (
    <div
      className={`lane-detail is-${node.placement ?? 'above'}`}
      style={node.placement === 'inline' ? undefined : { left, top: node.y }}
      role="status"
    >
      <p className="lane-detail-head">
        <strong>Bay {bay.number}</strong>
        <span className={`lane-detail-state is-${bay.state}`}>{BAY_STATE_LABEL[bay.state]}</span>
      </p>
      {session ? (
        <dl>
          <div>
            <dt>Driver</dt>
            <dd>{session.driverName ?? session.idTag}</dd>
          </div>
          <div>
            <dt>Drawing</dt>
            <dd>
              {kw(session.currentPowerKw)} kW{session.limitKw === null ? '' : ` of ${kw(session.limitKw)}`}
            </dd>
          </div>
          <div>
            <dt>Still needs</dt>
            <dd>{bay.remainingKwh.toFixed(1)} kWh</dd>
          </div>
          <div>
            <dt>Leaves</dt>
            <dd>
              {clockTime(session.deadlineMs, timezone)}, {modeLabel[session.mode]?.toLowerCase()}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="lane-detail-why">{bay.why}</p>
    </div>
  );
}

export function LaneLegend({ bays }: { readonly bays: readonly Bay[] }) {
  const counts = bayCounts(bays);
  return (
    <p className="lane-legend">
      <span>
        <i className="key is-charging" aria-hidden="true" />
        Charging {counts.charging}
      </span>
      <span>
        <i className="key is-holding" aria-hidden="true" />
        Holding {counts.holding}
      </span>
      <span>
        <i className="key is-free" aria-hidden="true" />
        Free {counts.free}
      </span>
      {counts.charged > 0 ? (
        <span>
          <i className="key is-charged" aria-hidden="true" />
          Charged {counts.charged}
        </span>
      ) : null}
      {counts.urgent > 0 ? (
        <span>
          <i className="key is-urgent" aria-hidden="true" />
          Urgent {counts.urgent}
        </span>
      ) : null}
      {counts.offline > 0 ? (
        <span>
          <i className="key is-offline" aria-hidden="true" />
          Offline {counts.offline}
        </span>
      ) : null}
    </p>
  );
}
