'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { saveAccess } from '../lib/access';
import { api } from '../lib/api';

/** How long a check may take before the visitor is told the server is probably waking up. */
const SLOW_CHECK_MS = 4_000;

/**
 * The way into the deployed console: one access code, and nothing else.
 *
 * Every operator, and the grid operator, has a code of their own. The code says who is signing in,
 * so there is no list of people to pick from and a code handed to one site's operator opens that
 * site and no other. Driver codes belong to the app, and are turned away here with a pointer to it.
 */
export function AccessGate() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);

  // A hosted demo server sleeps when nobody uses it, and the first request waits while it wakes.
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_CHECK_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  const signIn = (event: FormEvent): void => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    void api
      .accountFor(trimmed)
      .then((account) => {
        if (account.role === 'driver') {
          setError('That code belongs to a driver. Drivers sign in on the CleanGrid app.');
          return;
        }
        saveAccess({ code: trimmed, accountId: account.id, accountName: account.displayName, role: account.role, siteId: account.siteId });
      })
      .catch((caught: Error) => setError(caught.message))
      .finally(() => setBusy(false));
  };

  return (
    <main className="gate">
      <div className="gate-inner">
        <p className="gate-brand">
          <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
            <rect width="30" height="30" rx="9" fill="var(--forest)" />
            <path d="M8.5 20.5c0-7 5.2-11.6 13-12-.3 7.8-4.9 13-12 13" fill="var(--lime)" />
            <path d="M9 21c2.8-3.4 5.8-6 9.2-8.1" stroke="var(--forest)" strokeWidth="1.4" strokeLinecap="round" fill="none" />
          </svg>
          CleanGrid
        </p>
        <h1 className="title">The operator console.</h1>
        <p className="body">This is a live demo. Enter the access code you were given; it signs you in as the operator it belongs to.</p>

        <form className="gate-form" onSubmit={signIn}>
          <label htmlFor="access-code" className="caption">
            Access code
          </label>
          <input
            id="access-code"
            className="gate-input"
            type="password"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
            autoFocus
          />
          {error ? (
            <p className="notice is-error" role="alert">
              {error}
            </p>
          ) : null}
          {slow ? (
            <p className="caption" role="status">
              Waking the demo server. It sleeps when nobody is using it, and can take up to a minute to start.
            </p>
          ) : null}
          <button type="submit" className="btn is-primary" disabled={busy || code.trim().length === 0}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
