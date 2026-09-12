'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { api } from '../lib/api';
import { clockTime } from '../lib/format';
import type { Site } from '../lib/types';

interface Who {
  readonly displayName: string;
  readonly siteId: string | null;
}

/** The console frame: who you are, which site you are looking at, and what time it is there. */

export type ConsolePage = 'overview' | 'forecast' | 'schedules' | 'grid' | 'impact';

const NAV: { page: ConsolePage; href: string; label: string; icon: IconName }[] = [
  { page: 'overview', href: '/', label: 'Overview', icon: 'overview' },
  { page: 'forecast', href: '/forecast', label: 'Forecast', icon: 'forecast' },
  { page: 'schedules', href: '/schedules', label: 'Schedules', icon: 'schedules' },
  { page: 'grid', href: '/grid', label: 'Grid flex', icon: 'flex' },
  { page: 'impact', href: '/impact', label: 'Impact', icon: 'impact' },
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
  const [who, setWho] = useState<Who | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  // Show who the console is actually signed in as, rather than a name baked into the markup.
  useEffect(() => {
    void api
      .me()
      .then((me) => setWho({ displayName: me.displayName, siteId: me.siteId }))
      .catch(() => undefined);
  }, []);

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
              <Icon name={item.icon} size={17} />
              <span className="nav-label">{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="who">
          {who?.displayName ?? 'Signing in…'}
          <br />
          {who === null ? '' : who.siteId === null ? 'Network operator' : `Operator · ${who.siteId}`}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="site-switch" ref={box}>
            <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
              <Icon name="pin" size={16} />
              {site?.name ?? 'Loading sites'}
              <span className="caret">
                <Icon name="chevron" size={15} />
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
          <span className="avatar" title={who?.displayName ?? undefined}>
            {(who?.displayName ?? '?')
              .split(' ')
              .slice(0, 2)
              .map((word) => word[0] ?? '')
              .join('')
              .toUpperCase()}
          </span>
        </header>
        {children}
      </main>
    </div>
  );
}
