'use client';

import { useMemo, useState } from 'react';
import { useSize } from '../scene/useSize';
import { LaneDetail, type LaneNode } from './ChargerLane';
import { BAY_STATE_LABEL, type Bay } from '../../lib/bays';

/**
 * The car park seen from above, drawn as a landscaped plan.
 *
 * Two gently curved rows of bays either side of a planted central lane, in the order the chargers
 * are numbered. This is the question a map answers and a table cannot: whether the far row is idle
 * while the entrance is full. Every bay is here, including the ones that are offline, and pointing
 * at any of them opens the same detail the valley scene uses.
 */

export function SitePlan({
  bays,
  timezone,
  onChoose,
}: {
  readonly bays: readonly Bay[];
  readonly timezone: string;
  readonly onChoose: (bay: Bay) => void;
}) {
  const { ref, size } = useSize<HTMLDivElement>({ width: 1200, height: 360 });
  const { width, height } = size;
  const [hovered, setHovered] = useState<string | null>(null);

  const plan = useMemo(() => {
    const laneY = (px: number): number => height * 0.5 + height * 0.07 * Math.sin((px / width) * Math.PI * 1.1 - 0.4);
    const slope = (px: number): number => (laneY(px + 1) - laneY(px - 1)) / 2;
    const perRow = Math.max(1, Math.ceil(bays.length / 2));
    const from = width * 0.1;
    const to = width * 0.9;
    const bayW = Math.min(64, ((to - from) / perRow) * 0.72);
    const bayH = Math.min(96, height * 0.26);

    const nodes: (LaneNode & { angle: number; row: number })[] = bays.map((bay, index) => {
      const row = index < perRow ? 0 : 1;
      const column = row === 0 ? index : index - perRow;
      const px = perRow === 1 ? (from + to) / 2 : from + ((to - from) * column) / (perRow - 1);
      const offset = (bayH / 2 + height * 0.1) * (row === 0 ? -1 : 1);
      const angle = (Math.atan(slope(px)) * 180) / Math.PI;
      // A bay in the top row opens its detail downwards, towards the lane, so the layer stays in view.
      return { bay, x: px, y: laneY(px) + offset, angle, row, placement: row === 0 ? ('below' as const) : ('above' as const) };
    });

    const lane: string[] = [];
    for (let px = -10; px <= width + 10; px += 10) lane.push(`${px},${laneY(px).toFixed(1)}`);

    const trees = Array.from({ length: 26 }, (_, index) => {
      const u = (index + 0.5) / 26;
      const top = index % 2 === 0;
      return {
        x: u * width + Math.sin(index * 3.1) * 14,
        y: top ? height * (0.06 + 0.04 * Math.sin(index)) : height * (0.94 - 0.04 * Math.cos(index)),
        r: 10 + ((index * 7) % 9),
      };
    });

    return { lane: `M${lane.join(' L')}`, nodes, bayW, bayH, trees };
  }, [bays, width, height]);

  const shown = plan.nodes.find((node) => node.bay.charger.id === hovered) ?? null;
  // On a phone the plan is too short for a floating layer not to cover the bays or the legend below it.
  const inline = width < 560;

  if (bays.length === 0) return <p className="empty">This site has no chargers registered yet.</p>;

  return (
    <>
    <div className="siteplan" ref={ref}>
      <div className="siteplan-art">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Car park plan">
        <rect x="0" y="0" width={width} height={height} className="siteplan-ground" />
        {plan.trees.map((tree, index) => (
          <g key={index} className="siteplan-tree" aria-hidden="true">
            <circle cx={tree.x} cy={tree.y} r={tree.r} />
            <circle cx={tree.x + tree.r * 0.45} cy={tree.y - tree.r * 0.3} r={tree.r * 0.62} />
          </g>
        ))}
        <path d={plan.lane} className="siteplan-lane" aria-hidden="true" />
        <path d={plan.lane} className="siteplan-verge" aria-hidden="true" />

        {plan.nodes.map((node) => {
          const { bay } = node;
          return (
            <g
              key={bay.charger.id}
              className={`siteplan-bay is-${bay.state}${hovered === bay.charger.id ? ' is-hovered' : ''}`}
              transform={`translate(${node.x.toFixed(1)} ${node.y.toFixed(1)}) rotate(${node.angle.toFixed(1)})`}
              tabIndex={0}
              role="button"
              aria-label={`Bay ${bay.number}, ${BAY_STATE_LABEL[bay.state]}. ${bay.why}`}
              onMouseEnter={() => setHovered(bay.charger.id)}
              onMouseLeave={() => setHovered((current) => (current === bay.charger.id ? null : current))}
              onFocus={() => setHovered(bay.charger.id)}
              onBlur={() => setHovered((current) => (current === bay.charger.id ? null : current))}
              onClick={() => onChoose(bay)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onChoose(bay);
                }
              }}
            >
              <rect x={-plan.bayW / 2} y={-plan.bayH / 2} width={plan.bayW} height={plan.bayH} rx="8" className="siteplan-slot" />
              {bay.session ? (
                <rect
                  x={-plan.bayW * 0.3}
                  y={-plan.bayH * 0.34}
                  width={plan.bayW * 0.6}
                  height={plan.bayH * 0.62}
                  rx={plan.bayW * 0.18}
                  className="siteplan-car"
                />
              ) : null}
              <text y={(node.row === 0 ? -1 : 1) * (plan.bayH / 2 + 16) + 4} className="siteplan-number">
                {bay.number}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      {inline ? null : <LaneDetail node={shown} width={width} timezone={timezone} />}
    </div>
    {inline && shown ? <LaneDetail node={{ ...shown, placement: 'inline' }} width={width} timezone={timezone} /> : null}
    </>
  );
}
