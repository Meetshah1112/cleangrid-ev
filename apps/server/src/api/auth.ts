import { ROLES, accessCodeFor, normaliseAccessCode, type Role, type UserProfile } from '@cleangrid/shared';
import { jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { AppError, ForbiddenError, UnauthorizedError } from '../errors';
import type { Repositories } from '../repo/types';
import type { ApiContext, Principal } from './context';

/**
 * Three ways in, chosen by configuration, in this order:
 *
 *  - ACCESS_CODE_SECRET: the deployed demo. Every seeded account has its own access code, derived
 *    from the secret, and the code alone says who is signing in. The account's stored profile
 *    decides what it may do.
 *  - DEV_AUTH: local development. x-dev-role / x-dev-user headers are trusted as they come.
 *  - otherwise a Supabase JWT, with the role again taken from the stored profile.
 */

/** What the API and the socket upgrades share about who may come in. */
export interface AccessControl {
  readonly codes: AccessCodeBook | null;
  readonly guard: AccessGuard;
}

export function createAccessControl(ctx: Pick<ApiContext, 'config' | 'repos' | 'runtimes'>): AccessControl {
  const secret = ctx.config.ACCESS_CODE_SECRET;
  return {
    codes: secret ? new AccessCodeBook(secret, ctx.repos, (siteId) => ctx.runtimes.has(siteId)) : null,
    guard: new AccessGuard(),
  };
}

export async function authenticate(request: FastifyRequest, ctx: ApiContext, access: AccessControl): Promise<Principal> {
  if (access.codes) {
    const profile = await checkCode(header(request, 'x-access-code'), request.ip, access.codes, access.guard);
    return principalOf(profile);
  }
  if (ctx.config.DEV_AUTH) return devPrincipal(request, ctx);

  const bearer = request.headers.authorization ?? '';
  const token = bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '';
  if (!token) throw new UnauthorizedError('a bearer token is required');

  let subject: string;
  try {
    const secret = new TextEncoder().encode(ctx.config.SUPABASE_JWT_SECRET ?? '');
    const { payload } = await jwtVerify(token, secret);
    subject = String(payload.sub ?? '');
  } catch {
    throw new UnauthorizedError('token rejected');
  }
  const profile = await ctx.repos.profiles.get(subject);
  if (!profile) throw new ForbiddenError('this account has no profile');
  return principalOf(profile);
}

/**
 * The account a presented code belongs to, or an error that says what was wrong with it. Wrong
 * codes count against the caller's address, and an address that has guessed too often is refused
 * before its code is even looked at.
 */
export async function checkCode(given: string | undefined, address: string, codes: AccessCodeBook, guard: AccessGuard): Promise<UserProfile> {
  const counted = !isLoopback(address);
  if (counted) guard.assertAllowed(address);
  if (!given) throw new AppError('access_code_required', 'enter your access code to continue', 401);
  const profile = await codes.accountFor(given);
  if (!profile) {
    if (counted) guard.recordFailure(address);
    throw new AppError('access_code_rejected', 'that access code is not right', 401);
  }
  return profile;
}

/**
 * Callers on the server's own machine are never locked out. The simulator runs there, and on a
 * laptop so do the browser and a phone on a USB cable, all from one address: a single stale tab
 * guessing with an old code would otherwise stop every simulated car for ten minutes. A visitor from
 * outside never arrives from loopback, because behind a proxy TRUST_PROXY reads the address the
 * proxy appended, which a client cannot write.
 */
function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

const principalOf = (profile: UserProfile): Principal => ({
  id: profile.id,
  role: profile.role,
  siteId: profile.siteId,
  displayName: profile.displayName,
});

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Finds the account a code belongs to.
 *
 * Every account's code is worked out from the secret once, and kept by a hash of the code rather
 * than the code, so looking one up says nothing about the codes it did not match. The book is
 * rebuilt when the set of accounts changes. Accounts at a site this server is not running are not
 * let in: the database keeps every profile a scenario ever seeded, and a driver whose car park no
 * longer exists would open onto an empty app.
 */
export class AccessCodeBook {
  private cache: { readonly key: string; readonly idsByDigest: ReadonlyMap<string, string> } | null = null;

  constructor(
    private readonly secret: string,
    private readonly repos: Pick<Repositories, 'profiles'>,
    private readonly siteRunning: (siteId: string) => boolean,
  ) {}

  async accountFor(given: string | undefined): Promise<UserProfile | null> {
    const typed = normaliseAccessCode(given ?? '');
    if (typed.length === 0) return null;
    const profiles = await this.repos.profiles.list();
    const id = this.index(profiles).get(digest(typed));
    const profile = id === undefined ? undefined : profiles.find((entry) => entry.id === id);
    if (!profile) return null;
    if (profile.siteId !== null && !this.siteRunning(profile.siteId)) return null;
    return profile;
  }

  private index(profiles: readonly UserProfile[]): ReadonlyMap<string, string> {
    const key = profiles.map((profile) => profile.id).join('\n');
    if (this.cache?.key === key) return this.cache.idsByDigest;
    const idsByDigest = new Map(profiles.map((profile) => [digest(normaliseAccessCode(accessCodeFor(this.secret, profile.id))), profile.id]));
    this.cache = { key, idsByDigest };
    return idsByDigest;
  }
}

/** Whether an account may watch a site's live console feed. */
export function canWatchSite(profile: Pick<UserProfile, 'role' | 'siteId'>, siteId: string): boolean {
  if (profile.role === 'grid_operator') return true;
  return profile.role === 'operator' && (profile.siteId === null || profile.siteId === siteId);
}

async function devPrincipal(request: FastifyRequest, ctx: ApiContext): Promise<Principal> {
  const userId = header(request, 'x-dev-user');
  if (userId) {
    const profile = await ctx.repos.profiles.get(userId);
    if (profile) return principalOf(profile);
  }
  const requested = header(request, 'x-dev-role') || 'operator';
  if (!(ROLES as readonly string[]).includes(requested)) {
    throw new UnauthorizedError(`x-dev-role must be one of ${ROLES.join(', ')}`);
  }
  const role = requested as Role;
  return {
    id: userId || `dev-${role}`,
    role,
    siteId: role === 'grid_operator' ? null : ctx.defaultSiteId,
    displayName: userId || `dev ${role}`,
  };
}

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  return String(Array.isArray(value) ? value[0] : (value ?? '')).trim();
}

const GUESS_WINDOW_MS = 10 * 60_000;
const GUESSES_ALLOWED = 20;
/** Addresses remembered at once. Past this the stalest are dropped, so guessing from many addresses cannot fill memory. */
const MAX_TRACKED_ADDRESSES = 10_000;

/**
 * Counts wrong access codes per address, and refuses an address that has guessed too often in a
 * ten-minute window. A code handed to a jury is not a password, but it should not be something a
 * script can walk through either.
 */
export class AccessGuard {
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get trackedAddresses(): number {
    return this.failures.size;
  }

  assertAllowed(address: string): void {
    const entry = this.failures.get(address);
    if (!entry) return;
    if (this.now() - entry.since > GUESS_WINDOW_MS) {
      this.failures.delete(address);
      return;
    }
    if (entry.count >= GUESSES_ALLOWED) {
      throw new AppError('too_many_attempts', 'too many wrong access codes; wait a few minutes and try again', 429);
    }
  }

  recordFailure(address: string): void {
    const entry = this.failures.get(address);
    const fresh = !entry || this.now() - entry.since > GUESS_WINDOW_MS;
    // Re-inserting keeps the map in order of last guess, oldest first, which is what makeRoom trims.
    this.failures.delete(address);
    if (!entry) this.makeRoom();
    this.failures.set(address, fresh ? { count: 1, since: this.now() } : { count: entry.count + 1, since: entry.since });
  }

  /** Drops the address whose last wrong guess is oldest. One deletion, never a scan, however busy the guessing. */
  private makeRoom(): void {
    if (this.failures.size < MAX_TRACKED_ADDRESSES) return;
    const stalest = this.failures.keys().next().value;
    if (stalest !== undefined) this.failures.delete(stalest);
  }
}

export function requireRole(principal: Principal, ...roles: readonly Role[]): void {
  if (!roles.includes(principal.role)) {
    throw new ForbiddenError(`this endpoint is for ${roles.join(' or ')}`);
  }
}

export function requireSite(principal: Principal, siteId: string): void {
  if (principal.role === 'grid_operator') return;
  if (principal.role === 'operator' && principal.siteId !== null && principal.siteId !== siteId) {
    throw new ForbiddenError('you do not operate this site');
  }
}

/** Drivers may only touch their own sessions; operators may touch any session at their site. */
export function requireSessionAccess(principal: Principal, session: { driverId: string | null; siteId: string }): void {
  if (principal.role === 'driver') {
    if (session.driverId !== principal.id) throw new ForbiddenError('this session belongs to another driver');
    return;
  }
  requireSite(principal, session.siteId);
}
