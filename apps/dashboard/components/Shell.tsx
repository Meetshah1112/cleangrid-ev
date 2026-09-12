'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { clockTime } from '../lib/format';
import type { Site } from '../lib/types';

/**
 * The console frame: one thin header over the page.
 *
 * Brand on the left, the five places an operator goes in the middle, and on the right the three
 * facts every page depends on: whether the numbers are live, what time it is at the site, and
 * which site they belong to.
 */

export type ConsolePage = 'overview' | 'forecast' | 'schedules' | 'grid' | 'impact';

const NAV: { page: ConsolePage; href: string; label: string }[] = [
  { page: 'overview', href: '/', label: 'Overview' },
  { page: 'forecast', href: '/forecast', label: 'Forecast' },
  { page: 'schedules', href: '/schedules', label: 'Schedules' },
  { page: 'grid', href: '/grid', label: 'Grid Flex' },
  { page: 'impact', href: '/impact', label: 'Impact' },
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

/** A leaf inside the CleanGrid square: the mark, drawn at the size it is used. */
function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
      <rect width="30" height="30" rx="9" fill="var(--forest)" />
      <path d="M8.5 20.5c0-7 5.2-11.6 13-12-.3 7.8-4.9 13-12 13" fill="var(--lime)" />
      <path d="M9 21c2.8-3.4 5.8-6 9.2-8.1" stroke="var(--forest)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Shell({ page, sites, site, onSelectSite, nowMs, timeScale, connected, children }: ShellProps) {
  const [open, setOpen] = useState(false);
  const [initials, setInitials] = useState('');
  const [who, setWho] = useState('');
  const picker = useRef<HTMLDivElement | null>(null);

  // Whoever the console is really signed in as, rather than a name baked into the markup.
  useEffect(() => {
    void api
      .me()
      .then((me) => {
        setWho(me.displayName);
        setInitials(
          me.displayName
            .split(' ')
            .slice(0, 2)
            .map((word) => word[0] ?? '')
            .join('')
            .toUpperCase(),
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent): void => {
      if (picker.current && !picker.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-inner">
          <a className="brand" href="/">
            <Mark />
            CleanGrid
          </a>

          <nav className="nav" aria-label="Console">
            {NAV.map((item) => (
              <a key={item.page} href={item.href} aria-current={item.page === page ? 'page' : undefined}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="masthead-status">
            <span className={connected ? 'live' : 'live is-polling'} title={connected ? 'Streaming live' : 'Refreshing every few seconds'}>
              <i aria-hidden="true" />
              <span>{connected ? 'Live' : 'Polling'}</span>
            </span>
            <span className="clock">
              {site && nowMs > 0 ? clockTime(nowMs, site.timezone) : '--:--'}
              {timeScale > 1 ? <span className="clock-scale"> at {timeScale}x</span> : null}
            </span>

            <div className="site-picker" ref={picker}>
              <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
                <span>{site?.name ?? 'Loading sites'}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                  <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {open ? (
                <div className="site-menu" role="menu">
                  {sites.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={entry.id === site?.id}
                      onClick={() => {
                        onSelectSite(entry.id);
                        setOpen(false);
                      }}
                    >
                      {entry.name}
                      <small>
                        {entry.gridConnectionKw} kW connection, {entry.currency}
                      </small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <span className="avatar" title={who || undefined} aria-label={who ? `Signed in as ${who}` : 'Signing in'}>
              {initials || '..'}
            </span>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
