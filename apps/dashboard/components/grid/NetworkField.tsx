'use client';

import { useState } from 'react';
import { useSize } from '../scene/useSize';
import { clockTime, kw } from '../../lib/format';
import type { GridSite } from '../../lib/types';

/**
 * Every site under this network operator, placed where it actually is, glowing as brightly as it
 * is drawing.
 *
 * Sites are grouped by country, and each group gets its own panel cropped to its own sites. One
 * frame around a car park in London and four in Gujarat is almost all empty space, with the four
 * Gujarat sites piled on one spot. Inside a panel the projection is equirectangular with the
 * longitude scaled for latitude, so distances between sites keep their proportions, and the
 * graticule behind them is honest: meridians and parallels, no invented coastline. A shoreline
 * drawn from memory would be decoration pretending to be data.
 */

const COUNTRY: Record<string, string> = {
  IN: 'India',
  GB: 'United Kingdom',
  FR: 'France',
  DE: 'Germany',
  NL: 'Netherlands',
  US: 'United States',
};

const GAP = 14;

interface Bounds {
  readonly west: number;
  readonly east: number;
  readonly north: number;
  readonly south: number;
}

interface Panel {
  readonly country: string;
  readonly sites: readonly GridSite[];
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A window around a group of sites, widened on one axis so a degree is the same distance both ways. */
function boundsFor(sites: readonly GridSite[], aspect: number): Bounds {
  const lats = sites.map((site) => site.lat);
  const lngs = sites.map((site) => site.lng);
  const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const squeeze = Math.max(0.2, Math.cos((midLat * Math.PI) / 180));
  let latSpan = Math.max(1.2, (Math.max(...lats) - Math.min(...lats)) * 1.7);
  let lngSpan = Math.max(1.6, (Math.max(...lngs) - Math.min(...lngs)) * 1.5);
  if ((lngSpan * squeeze) / latSpan < aspect) lngSpan = (latSpan * aspect) / squeeze;
  else latSpan = (lngSpan * squeeze) / aspect;
  const midLng = (Math.max(...lngs) + Math.min(...lngs)) / 2;
  return { west: midLng - lngSpan / 2, east: midLng + lngSpan / 2, north: midLat + latSpan / 2, south: midLat - latSpan / 2 };
}

function graticule(from: number, to: number, count: number): number[] {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 45, 60, 90];
  const step = steps.find((value) => value >= (to - from) / count) ?? 90;
  const out: number[] = [];
  for (let value = Math.ceil(from / step) * step; value <= to + 1e-9; value += step) out.push(Math.round(value * 100) / 100);
  return out;
}

const degrees = (value: number, positive: string, negative: string): string =>
  `${Math.abs(value) % 1 === 0 ? Math.abs(value) : Math.abs(value).toFixed(value % 0.5 === 0 ? 1 : 2)}°${value >= 0 ? positive : negative}`;

/** The biggest group takes the main panel; the rest share a column beside it, or a row below on a phone. */
function panelsFor(sites: readonly GridSite[], width: number, height: number): Panel[] {
  const groups = new Map<string, GridSite[]>();
  for (const site of sites) groups.set(site.country, [...(groups.get(site.country) ?? []), site]);
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  if (ordered.length === 0) return [];
  const [main, ...rest] = ordered;
  if (!main) return [];
  if (rest.length === 0) return [{ country: main[0], sites: main[1], x: 0, y: 0, w: width, h: height }];

  const narrow = width < 560;
  if (narrow) {
    const mainH = Math.round(height * 0.64);
    const cellW = (width - GAP * (rest.length - 1)) / rest.length;
    return [
      { country: main[0], sites: main[1], x: 0, y: 0, w: width, h: mainH },
      ...rest.map(([country, group], index) => ({ country, sites: group, x: index * (cellW + GAP), y: mainH + GAP, w: cellW, h: height - mainH - GAP })),
    ];
  }
  const mainW = Math.round(width * 0.68);
  const cellH = (height - GAP * (rest.length - 1)) / rest.length;
  return [
    { country: main[0], sites: main[1], x: 0, y: 0, w: mainW, h: height },
    ...rest.map(([country, group], index) => ({ country, sites: group, x: mainW + GAP, y: index * (cellH + GAP), w: width - mainW - GAP, h: cellH })),
  ];
}

interface Label {
  readonly x: number;
  readonly y: number;
  /** Beside the point rather than under it, because another point is too close for a name below. */
  readonly beside: boolean;
  readonly leader: boolean;
}

/**
 * Names are laid out rather than placed. A site with room keeps its name centred under its point.
 * Sites close to another point take their names to the right instead, stacked top to bottom so no
 * two collide, with a leader line back to the point when a name has to drop below it. Points never
 * move; only text does.
 */
function labelsFor(points: readonly { y: number; x: number; r: number }[], gap: number): Label[] {
  const out: Label[] = new Array(points.length);
  const near = (index: number): boolean =>
    points.some((other, otherIndex) => otherIndex !== index && Math.hypot(other.x - (points[index]?.x ?? 0), other.y - (points[index]?.y ?? 0)) < 60);
  const order = points.map((point, index) => ({ ...point, index })).sort((a, b) => a.y - b.y || a.x - b.x);
  let lowestBeside = Number.NEGATIVE_INFINITY;
  for (const point of order) {
    if (!near(point.index)) {
      out[point.index] = { x: point.x, y: point.y + point.r + 18, beside: false, leader: false };
      continue;
    }
    const natural = point.y + 4;
    const y = Math.max(natural, lowestBeside + gap);
    out[point.index] = { x: point.x + point.r + 12, y, beside: true, leader: y > natural + 1 };
    lowestBeside = y;
  }
  return out;
}

export function NetworkField({
  sites,
  selectedId,
  nowMs,
  reductionPct,
  onSelect,
}: {
  readonly sites: readonly GridSite[];
  readonly selectedId: string | null;
  readonly nowMs: number;
  readonly reductionPct: number;
  readonly onSelect: (siteId: string) => void;
}) {
  const { ref, size } = useSize<HTMLDivElement>({ width: 900, height: 380 });
  const [hovered, setHovered] = useState<string | null>(null);
  const { width, height } = size;
  const panels = panelsFor(sites, width, height);
  const shown = sites.find((site) => site.siteId === (hovered ?? selectedId)) ?? sites[0] ?? null;

  return (
    <div className="field">
      <div className="field-map" ref={ref}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Sites under this network operator, by country">
          <defs>
            <radialGradient id="field-glow">
              <stop offset="0" stopColor="rgb(185 227 107)" stopOpacity="0.55" />
              <stop offset="1" stopColor="rgb(185 227 107)" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="field-glow-hot">
              <stop offset="0" stopColor="rgb(217 100 76)" stopOpacity="0.6" />
              <stop offset="1" stopColor="rgb(217 100 76)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {panels.map((panel) => (
            <FieldPanel key={panel.country} panel={panel} selectedId={selectedId} hovered={hovered} onHover={setHovered} onSelect={onSelect} />
          ))}
        </svg>
      </div>

      <div className="field-readout" aria-live="polite">
        {shown ? (
          <>
            <p className="eyebrow">{shown.siteId === selectedId ? 'Selected site' : 'Point at a site'}</p>
            <h3 className="subtitle">{shown.name}</h3>
            <dl className="field-facts">
              <div>
                <dt>Drawing</dt>
                <dd>
                  <strong>{kw(shown.currentDrawKw)}</strong> of {kw(shown.gridConnectionKw, 0)} kW
                </dd>
              </div>
              <div>
                <dt>Flexible now</dt>
                <dd>{kw(shown.flexibleKw)} kW</dd>
              </div>
              <div>
                <dt>Cars plugged in</dt>
                <dd>{shown.carsPluggedIn}</dd>
              </div>
              <div>
                <dt>Planned peak</dt>
                <dd>{shown.plannedPeakKw === null ? 'no plan yet' : `${kw(shown.plannedPeakKw)} kW`}</dd>
              </div>
            </dl>
            <p className="caption">
              A {reductionPct}% request here would hold it below{' '}
              {kw((shown.currentDrawKw > 0.5 ? shown.currentDrawKw : shown.gridConnectionKw) * (1 - reductionPct / 100), 0)} kW, and it could give{' '}
              {kw(Math.min(shown.flexibleKw, shown.currentDrawKw * (reductionPct / 100)))} kW of that from charging without touching a deadline.
            </p>
            <p className="caption field-where">
              {COUNTRY[shown.country] ?? shown.country}, {nowMs > 0 ? `${clockTime(nowMs, shown.timezone)} local, ` : ''}
              {degrees(shown.lat, 'N', 'S')} {degrees(shown.lng, 'E', 'W')}
            </p>
            {shown.siteId !== selectedId ? (
              <button type="button" className="btn is-small" onClick={() => onSelect(shown.siteId)}>
                Respond for this site
              </button>
            ) : null}
          </>
        ) : (
          <p className="empty">No sites reporting.</p>
        )}
      </div>
    </div>
  );
}

function FieldPanel({
  panel,
  selectedId,
  hovered,
  onHover,
  onSelect,
}: {
  readonly panel: Panel;
  readonly selectedId: string | null;
  readonly hovered: string | null;
  readonly onHover: (update: (current: string | null) => string | null) => void;
  readonly onSelect: (siteId: string) => void;
}) {
  const pad = { x: 40, top: 56, bottom: 30 };
  const innerW = Math.max(1, panel.w - pad.x * 2);
  const innerH = Math.max(1, panel.h - pad.top - pad.bottom);
  const bounds = boundsFor(panel.sites, innerW / innerH);
  const project = (lat: number, lng: number) => ({
    x: panel.x + pad.x + ((lng - bounds.west) / (bounds.east - bounds.west)) * innerW,
    y: panel.y + pad.top + ((bounds.north - lat) / (bounds.north - bounds.south)) * innerH,
  });
  const placed = panel.sites.map((site) => {
    const used = site.gridConnectionKw > 0 ? Math.min(1.2, site.currentDrawKw / site.gridConnectionKw) : 0;
    return { site, used, r: 6 + Math.min(1, used) * 12, ...project(site.lat, site.lng) };
  });
  const labels = labelsFor(placed, 18);
  const count = panel.sites.length;

  // The graticule is background: on a small panel its degree labels give way to each other and to
  // the site names, rather than printing over them. The lines themselves always stay.
  const names = placed.map(({ site, x, y, r }, index) => {
    const label = labels[index] ?? { x, y: y + r + 18, beside: false, leader: false };
    const width = (site.name.split(' ')[0] ?? site.name).length * 7.6;
    const from = label.beside ? label.x : label.x - width / 2;
    return { x0: from, x1: from + width, y0: label.y - 13, y1: label.y + 3 };
  });
  const clearOfNames = (x0: number, x1: number, y0: number, y1: number): boolean =>
    names.every((name) => x1 < name.x0 - 4 || x0 > name.x1 + 4 || y1 < name.y0 - 2 || y0 > name.y1 + 2);
  const TICK_CHAR_W = 6.4;
  const meridians = graticule(bounds.west, bounds.east, Math.max(2, Math.round(innerW / 160))).map((lng) => {
    const { x } = project(bounds.north, lng);
    const text = degrees(lng, 'E', 'W');
    const half = (text.length * TICK_CHAR_W) / 2;
    const baseline = panel.y + panel.h - 10;
    return { lng, x, text, labelled: clearOfNames(x - half, x + half, baseline - 11, baseline + 2) };
  });
  let lastLabelledY = Number.NEGATIVE_INFINITY;
  const parallels = graticule(bounds.south, bounds.north, Math.max(2, Math.round(innerH / 90)))
    .map((lat) => ({ lat, y: project(lat, bounds.west).y, text: degrees(lat, 'N', 'S') }))
    .sort((a, b) => a.y - b.y)
    .map((line) => {
      const end = panel.x + panel.w - 8;
      const labelled = line.y - lastLabelledY >= 18 && clearOfNames(end - line.text.length * TICK_CHAR_W, end, line.y - 15, line.y - 2);
      if (labelled) lastLabelledY = line.y;
      return { ...line, labelled };
    });

  return (
    <g>
      <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} className="field-panel" />
      {/* Country and count on separate lines, so a narrow panel never cuts the name off. */}
      <text x={panel.x + 16} y={panel.y + 24} className="field-region">
        {COUNTRY[panel.country] ?? panel.country}
      </text>
      <text x={panel.x + 16} y={panel.y + 41} className="field-count">
        {count} site{count === 1 ? '' : 's'}
      </text>

      {meridians.map(({ lng, x, text, labelled }) => (
        <g key={`m${lng}`}>
          <line x1={x} x2={x} y1={panel.y + pad.top - 6} y2={panel.y + panel.h - pad.bottom + 6} className="field-grid" />
          {labelled ? (
            <text x={x} y={panel.y + panel.h - 10} className="field-tick">
              {text}
            </text>
          ) : null}
        </g>
      ))}
      {parallels.map(({ lat, y, text, labelled }) => (
        <g key={`p${lat}`}>
          <line x1={panel.x + pad.x - 6} x2={panel.x + panel.w - pad.x + 6} y1={y} y2={y} className="field-grid" />
          {labelled ? (
            <text x={panel.x + panel.w - 8} y={y - 4} className="field-tick is-end">
              {text}
            </text>
          ) : null}
        </g>
      ))}

      {placed.map(({ site, used, r, x, y }, index) => {
        const label = labels[index] ?? { x, y: y + r + 18, beside: false, leader: false };
        const hot = used > 0.9;
        const active = site.siteId === (hovered ?? selectedId);
        return (
          <g
            key={site.siteId}
            className={`field-site${active ? ' is-active' : ''}${site.siteId === selectedId ? ' is-selected' : ''}`}
            tabIndex={0}
            role="button"
            aria-pressed={site.siteId === selectedId}
            aria-label={`${site.name}, drawing ${kw(site.currentDrawKw)} of ${kw(site.gridConnectionKw, 0)} kW`}
            onMouseEnter={() => onHover(() => site.siteId)}
            onMouseLeave={() => onHover((current) => (current === site.siteId ? null : current))}
            onFocus={() => onHover(() => site.siteId)}
            onBlur={() => onHover((current) => (current === site.siteId ? null : current))}
            onClick={() => onSelect(site.siteId)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(site.siteId);
              }
            }}
          >
            <circle cx={x} cy={y} r={r * 3} fill={hot ? 'url(#field-glow-hot)' : 'url(#field-glow)'} />
            {label.leader ? <line x1={x + r * 0.7} x2={label.x - 4} y1={y + r * 0.7} y2={label.y - 4} className="field-leader" /> : null}
            <circle cx={x} cy={y} r={r} className={`field-dot${hot ? ' is-hot' : ''}`} />
            <text x={label.x} y={label.y} className={`field-name${label.beside ? ' is-beside' : ''}`}>
              {site.name.split(' ')[0]}
            </text>
          </g>
        );
      })}
    </g>
  );
}
