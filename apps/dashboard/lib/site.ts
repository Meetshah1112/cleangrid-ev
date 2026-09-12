'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { Site } from './types';

/**
 * Which site the console is looking at. Kept in the URL hash so a view can be shared, and
 * remembered between visits.
 */

const STORAGE_KEY = 'cleangrid.site';

export interface SiteSelection {
  readonly sites: Site[];
  readonly site: Site | null;
  readonly siteId: string | null;
  readonly select: (siteId: string) => void;
  readonly error: string | null;
}

function remembered(): string | null {
  if (typeof window === 'undefined') return null;
  const fromHash = window.location.hash.replace(/^#/, '');
  if (fromHash) return fromHash;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useSiteSelection(): SiteSelection {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .sites()
      .then((list) => {
        setSites(list);
        setError(null);
        setSiteId((current) => {
          if (current && list.some((site) => site.id === current)) return current;
          const wanted = remembered();
          return list.find((site) => site.id === wanted)?.id ?? list[0]?.id ?? null;
        });
      })
      .catch((caught: Error) => setError(caught.message));
  }, []);

  const select = useCallback((next: string) => {
    setSiteId(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      window.location.hash = next;
    } catch {
      // a private window: the choice simply does not persist
    }
  }, []);

  return { sites, site: sites.find((entry) => entry.id === siteId) ?? null, siteId, select, error };
}
