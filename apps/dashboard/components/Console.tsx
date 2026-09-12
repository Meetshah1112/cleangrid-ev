'use client';

import type { ReactNode } from 'react';
import { useSiteSelection } from '../lib/site';
import { useLiveSite, type LiveSite } from '../lib/useLiveSite';
import { Shell, type ConsolePage } from './Shell';
import type { Site } from '../lib/types';

/** Every page is the same frame around different content, wired to the selected site. */
export function Console({
  page,
  children,
}: {
  readonly page: ConsolePage;
  readonly children: (context: { site: Site | null; live: LiveSite; selectSite: (siteId: string) => void }) => ReactNode;
}) {
  const selection = useSiteSelection();
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
    >
      {error ? (
        <div className="server-down">
          <p className="notice is-error" role="alert">
            The CleanGrid server is not answering ({error}). Figures below are the last ones received.
          </p>
        </div>
      ) : null}
      <main>{children({ site: selection.site, live, selectSite: selection.select })}</main>
    </Shell>
  );
}
