'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { clearAccess, currentAccess, onAccessChanged, type Access, type ConsoleRole } from '../lib/access';
import { useSiteSelection } from '../lib/site';
import { useLiveSite, type LiveSite } from '../lib/useLiveSite';
import { AccessGate } from './AccessGate';
import { Shell, type ConsolePage } from './Shell';
import type { Site } from '../lib/types';

/** `role` decides which controls a page offers; the server decides what they may actually do. */
type Render = (context: { site: Site | null; live: LiveSite; selectSite: (siteId: string) => void; role: ConsoleRole }) => ReactNode;

/**
 * Every page is the same frame around different content, wired to the selected site, and behind the
 * demo's access gate. Access is read only after the browser has mounted, because the server render
 * cannot see this browser's storage and the two must agree on the first frame.
 */
export function Console({ page, children }: { readonly page: ConsolePage; readonly children: Render }) {
  const [access, setAccess] = useState<Access | null | undefined>(undefined);

  useEffect(() => {
    setAccess(currentAccess());
    return onAccessChanged(() => setAccess(currentAccess()));
  }, []);

  if (access === undefined) return <div className="page" />;
  if (access === null) return <AccessGate />;
  // Keyed by account, so switching account starts every page from that account's own data.
  return <SignedIn key={access.accountId} page={page} access={access} render={children} />;
}

function SignedIn({ page, access, render }: { readonly page: ConsolePage; readonly access: Access; readonly render: Render }) {
  const selection = useSiteSelection(access.siteId);
  const live = useLiveSite(selection.siteId);
  const error = selection.error ?? live.error;

  return (
    <Shell
      page={page}
      sites={selection.sites}
      site={selection.site}
      onSelectSite={selection.select}
      nowMs={live.nowMs}
      timeScale={live.timeScale}
      connected={live.connected}
      accountName={access.accountName}
      onSwitchAccount={clearAccess}
    >
      {error ? (
        <div className="server-down">
          <p className="notice is-error" role="alert">
            The CleanGrid server is not answering ({error}). Figures below are the last ones received.
          </p>
        </div>
      ) : null}
      <main>{render({ site: selection.site, live, selectSite: selection.select, role: access.role })}</main>
    </Shell>
  );
}
