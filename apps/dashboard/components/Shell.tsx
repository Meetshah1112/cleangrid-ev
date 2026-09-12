'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clockTime } from '../lib/format';
import type { Site } from '../lib/types';

/** The console frame: who you are, which site you are looking at, and what time it is there. */

export type ConsolePage = 'overview' | 'forecast' | 'schedules' | 'grid' | 'impact';

const NAV: { page: ConsolePage; href: string; label: string; glyph: string }[] = [
  { page: 'overview', href: '/', label: 'Overview', glyph: '▦' },
  { page: 'forecast', href: '/forecast', label: 'Forecast', glyph: '∿' },
  { page: 'schedules', href: '/schedules', label: 'Schedules', glyph: '≡' },
  { page: 'grid', href: '/grid', label: 'Grid flex', glyph: '⚡' },
  { page: 'impact', href: '/impact', label: 'Impact', glyph: '◎' },
];

interface ShellProps {
  readonly page: ConsolePage;
  readonly sites: Site[];
  readonly site: Site | null;
  readonly onSelectSite: (siteId: string) => void;
  readonly nowMs: number;
  readonly timeScale: number;
  readonly connected: boolean;
  readonly children: ReactNode;
}

export function Shell({ page, sites, site, onSelectSite, nowMs, timeScale, connected, children }: ShellProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const close = (event: MouseEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="console">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">◗</span>
          CG / Ops
        </div>
        <nav>
          {NAV.map((item) => (
            <a key={item.page} href={item.href} className={item.page === page ? 'active' : ''}>
              <span className="glyph" aria-hidden>
                {item.glyph}
              </span>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="who">
          Priya Raman
          <br />
          Network operator
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="site-switch" ref={box}>
            <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
              <span aria-hidden>⌖</span>
              {site?.name ?? 'Loading sites'}
              <span aria-hidden style={{ color: 'var(--dim)' }}>
                ⌄
              </span>
            </button>
            {open && (
              <div className="menu" role="menu">
                {sites.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      onSelectSite(entry.id);
                      setOpen(false);
                    }}
                  >
                    {entry.name}
                    <small>
                      {entry.gridConnectionKw} kW connection · {entry.timezone.split('/')[1]?.replace('_', ' ')} ·{' '}
                      {entry.currency}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="spacer" />
          <span className={connected ? 'dot' : 'dot off'}>
            <i />
            {connected ? 'live' : 'polling'}
          </span>
          <span className="stamp">
            {site ? clockTime(nowMs, site.timezone) : '--:--'}
            {timeScale > 1 ? ` · ${timeScale}x` : ''}
          </span>
          <span className="avatar">PR</span>
        </header>
        {children}
      </main>
    </div>
  );
}
