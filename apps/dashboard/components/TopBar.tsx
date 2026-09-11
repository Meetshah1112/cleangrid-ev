'use client';

import { clockTime } from '../lib/format';

interface TopBarProps {
  readonly nowMs: number;
  readonly timeScale: number;
  readonly connected: boolean;
  readonly page: 'operations' | 'impact';
}

export function TopBar({ nowMs, timeScale, connected, page }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="wordmark">
        Clean<span>Grid</span> EV
      </div>
      <div className="site-name">Riverside Office Car Park</div>
      <nav>
        <a href="/" className={page === 'operations' ? 'active' : ''}>
          Operations
        </a>
        <a href="/impact" className={page === 'impact' ? 'active' : ''}>
          Impact
        </a>
      </nav>
      <div className="spacer" />
      <div className={connected ? 'live-dot' : 'live-dot offline'}>
        <i />
        {connected ? 'live' : 'polling'}
      </div>
      <div className="clock">
        {clockTime(nowMs)}
        {timeScale > 1 ? <small>{timeScale}x sim</small> : <small>site time</small>}
      </div>
    </header>
  );
}
