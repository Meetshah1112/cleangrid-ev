'use client';

/**
 * Who this browser is using the console as.
 *
 * The deployed demo has no sign-up and no passwords. Each seeded account has its own access code,
 * and the code alone decides who is signing in: the server looks it up and answers with the
 * account. What the account may do is decided on the server from its stored role; the role kept
 * here only decides which controls to show. Kept in this browser until the visitor signs out, and
 * dropped the moment the server refuses the code.
 */

export type ConsoleRole = 'operator' | 'grid_operator';

export interface Access {
  readonly code: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly role: ConsoleRole;
  /** Set when the account runs a single site: the console then shows only that site. */
  readonly siteId: string | null;
}

/** Who a code signs in as, as the server reports it. */
export interface Account {
  readonly id: string;
  readonly displayName: string;
  readonly role: 'driver' | ConsoleRole;
  readonly siteId: string | null;
}

const STORAGE_KEY = 'cleangrid.access';
const CHANGED = 'cleangrid:access-changed';
const ROLES: readonly string[] = ['operator', 'grid_operator'];

export function readAccess(): Access | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Access>;
    if (typeof parsed.code !== 'string' || typeof parsed.accountId !== 'string' || !ROLES.includes(String(parsed.role))) return null;
    return {
      code: parsed.code,
      accountId: parsed.accountId,
      accountName: parsed.accountName ?? parsed.accountId,
      role: parsed.role as ConsoleRole,
      siteId: parsed.siteId ?? null,
    };
  } catch {
    return null;
  }
}

export function saveAccess(access: Access): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(access));
  } catch {
    // A private window without storage: the sign-in lasts for this page only.
    memory = access;
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function clearAccess(): void {
  memory = null;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored
  }
  window.dispatchEvent(new Event(CHANGED));
}

let memory: Access | null = null;

/** The access in force: stored, or held for this page when storage is unavailable. */
export function currentAccess(): Access | null {
  return readAccess() ?? memory;
}

export function onAccessChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener('storage', listener);
  };
}

/** Codes the server sends when the access itself is the problem, rather than the request. */
export const ACCESS_ERRORS = new Set(['access_code_required', 'access_code_rejected']);
