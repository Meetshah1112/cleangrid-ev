'use client';

import { useState } from 'react';
import { clockTime, kw } from '../lib/format';
import type { GridSite } from '../lib/types';

/**
 * Every site under this operator, placed where it actually is.
 *
 * The projection is equirectangular and the graticule is drawn honestly: meridians and parallels,
 * no invented coastline. A network operator reading this wants to know which sites are near the
 * constraint and what each could shed, not what the shoreline looks like, and a hand-drawn
 * approximation of a country would be decoration pretending to be data.
 */

const WIDTH = 720;
const HEIGHT = 260;
const PAD = 26;

interface Window {
  readonly west: number;
  readonly east: number;
  readonly north: number;
  readonly south: number;
}

/**
 * The window is cropped to the sites rather than fixed at the whole globe. Two car parks on one
 * world map is mostly empty ocean, and the useful comparison is how far apart these particular
 * sites are, not where they sit relative to Antarctica.
 */
function windowFor(sites: readonly GridSite[]): Window {
  if (sites.length === 0) return { west: -180, east: 180, north: 85, south: -85 };
  const lats = sites.map((site) => site.lat);
  const lngs = sites.map((site) => site.lng);
  const padLat = Math.max(12, (Math.max(...lats) - Math.min(...lats)) * 0.35);
  const padLng = Math.max(18, (Math.max(...lngs) - Math.min(...lngs)) * 0.22);
  return {
    west: Math.max(-180, Math.min(...lngs) - padLng),
    east: Math.min(180, Math.max(...lngs) + padLng),
    north: Math.min(85, Math.max(...lats) + padLat),
    south: Math.max(-85, Math.min(...lats) - padLat),
  };
}

/** Equirectangular inside that window: longitude onto x, latitude onto y. */
const projector =
  (view: Window) =>
  (lat: number, lng: number): { x: number; y: number } => ({
    x: PAD + ((lng - view.west) / Math.max(1, view.east - view.west)) * (WIDTH - PAD * 2),
    y: PAD + ((view.north - lat) / Math.max(1, view.north - view.south)) * (HEIGHT - PAD * 2),
  });

/** Round graticule lines that actually fall inside the window. */
function ticks(from: number, to: number, count: number): number[] {
  const steps = [5, 10, 15, 30, 45, 60, 90];
  const target = (to - from) / count;
  const step = steps.find((value) => value >= target) ?? 90;
  const out: number[] = [];
  for (let value = Math.ceil(from / step) * step; value <= to; value += step) out.push(value);
  return out;
}

function loadTone(site: GridSite): string {
  const used = site.gridConnectionKw > 0 ? site.currentDrawKw / site.gridConnectionKw : 0;
  if (used > 0.9) return 'var(--red)';
  if (used > 0.75) return 'var(--amber)';
  return 'var(--green)';
}

export function NetworkMap({
  sites,
  selectedId,
  nowMs,
  onSelect,
}: {
  readonly sites: GridSite[];
  readonly selectedId: string | null;
  readonly nowMs: number;
  readonly onSelect: (siteId: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const view = windowFor(sites);
  const project = projector(view);
  const shown = sites.find((site) => site.siteId === (hovered ?? selectedId)) ?? sites[0] ?? null;

  const meridians = ticks(view.west, view.east, 5);
  const parallels = ticks(view.south, view.north, 4);

  return (
    <div className="netmap">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Sites under this operator">
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="12" className="netmap-ground" />

        {meridians.map((lng) => {
          const { x } = project(0, lng);
          return (
            <g key={`m${lng}`}>
              <line x1={x} y1={PAD} x2={x} y2={HEIGHT - PAD} className="netmap-grid" />
              <text x={x} y={HEIGHT - 9} className="netmap-tick">
                {lng === 0 ? '0°' : `${Math.abs(lng)}°${lng > 0 ? 'E' : 'W'}`}
              </text>
            </g>
          );
        })}
        {parallels.map((lat) => {
          const { y } = project(lat, 0);
          return (
            <g key={`p${lat}`}>
              <line x1={PAD} y1={y} x2={WIDTH - PAD} y2={y} className={lat === 0 ? 'netmap-grid is-equator' : 'netmap-grid'} />
              <text x={8} y={y + 3.5} className="netmap-tick is-start">
                {lat === 0 ? '0°' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`}
              </text>
            </g>
          );
        })}

        {sites.map((site) => {
          const { x, y } = project(site.lat, site.lng);
          const used = site.gridConnectionKw > 0 ? site.currentDrawKw / site.gridConnectionKw : 0;
          const radius = 9 + Math.min(1, used) * 9;
          const active = site.siteId === (hovered ?? selectedId);
          return (
            <g
              key={site.siteId}
              className={`netmap-site${active ? ' is-active' : ''}`}
              transform={`translate(${x} ${y})`}
              onMouseEnter={() => setHovered(site.siteId)}
              onMouseLeave={() => setHovered((current) => (current === site.siteId ? null : current))}
              onFocus={() => setHovered(site.siteId)}
              onBlur={() => setHovered((current) => (current === site.siteId ? null : current))}
              onClick={() => onSelect(site.siteId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(site.siteId);
              }}
              tabIndex={0}
              role="button"
              aria-label={`${site.name}, drawing ${site.currentDrawKw} of ${site.gridConnectionKw} kW`}
            >
              <circle r={radius + 7} className="netmap-halo" style={{ fill: loadTone(site) }} />
              <circle r={radius} className="netmap-dot" style={{ fill: loadTone(site) }} />
              <text y={radius + 16} className="netmap-name">
                {site.name.split(' ')[0]}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="netmap-readout">
        {shown ? (
          <>
            <strong>{shown.name}</strong>
            <span>
              {kw(shown.currentDrawKw)} of {kw(shown.gridConnectionKw, 0)} kW · {kw(shown.flexibleKw)} kW flexible ·{' '}
              {shown.carsPluggedIn} car{shown.carsPluggedIn === 1 ? '' : 's'}
            </span>
            <span className="netmap-where">
              {shown.country} · {clockTime(nowMs, shown.timezone)} local · {shown.lat.toFixed(2)}°,{' '}
              {shown.lng.toFixed(2)}°
            </span>
          </>
        ) : (
          <span>No sites reporting.</span>
        )}
      </div>
    </div>
  );
}
