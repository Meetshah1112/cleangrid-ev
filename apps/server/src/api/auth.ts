import { ROLES, type Role } from '@cleangrid/shared';
import { jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../errors';
import type { ApiContext, Principal } from './context';

/**
 * Dev mode trusts x-dev-role / x-dev-user headers so the simulator and dashboard work without
 * an auth provider. With DEV_AUTH=0 a Supabase JWT is required and the role comes from the
 * stored profile, never from the token body.
 */
export async function authenticate(request: FastifyRequest, ctx: ApiContext): Promise<Principal> {
  if (ctx.config.DEV_AUTH) return devPrincipal(request, ctx);

  const header = request.headers.authorization ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
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
  return { id: profile.id, role: profile.role, siteId: profile.siteId, displayName: profile.displayName };
}

async function devPrincipal(request: FastifyRequest, ctx: ApiContext): Promise<Principal> {
  const userId = String(request.headers['x-dev-user'] ?? '').trim();
  if (userId) {
    const profile = await ctx.repos.profiles.get(userId);
    if (profile) {
      return { id: profile.id, role: profile.role, siteId: profile.siteId, displayName: profile.displayName };
    }
  }
  const requested = String(request.headers['x-dev-role'] ?? 'operator');
  if (!(ROLES as readonly string[]).includes(requested)) {
    throw new UnauthorizedError(`x-dev-role must be one of ${ROLES.join(', ')}`);
  }
  const role = requested as Role;
  return {
    id: userId || `dev-${role}`,
    role,
    siteId: role === 'grid_operator' ? null : ctx.siteId,
    displayName: userId || `dev ${role}`,
  };
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
