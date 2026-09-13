import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { AccessGuard, canWatchSite, checkCode, type AccessCodeBook } from './api/auth';
import { WS_PATH_PREFIX } from './api/channel';
import type { AppConfig } from './config';
import { AppError } from './errors';
import type { Logger } from './logger';
import { OCPP_PATH_PREFIX } from './ocpp/gateway';
import { sameSecret } from './secret';

/**
 * Fastify does not own WebSocket upgrades, so chargers and console sockets are routed here by path,
 * and checked here, because its auth hook never sees them.
 */

type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer, id: string) => void;

export interface UpgradeDeps {
  readonly config: AppConfig;
  /** Set when access codes are on; the same book and guard the API uses. */
  readonly codes: AccessCodeBook | null;
  readonly guard?: AccessGuard;
  readonly logger?: Logger;
  readonly gateway: { readonly handleUpgrade: UpgradeHandler };
  readonly channel: { readonly handleUpgrade: UpgradeHandler };
}

/** The Authorization header a charger sends under OCPP 1.6 security profile 1. */
export function chargerCredentials(identity: string, key: string): string {
  return `Basic ${Buffer.from(`${identity}:${key}`).toString('base64')}`;
}

/** Whether the upgrade carries this charger's identity and the charger key. Open when no key is configured. */
function chargerAdmitted(request: IncomingMessage, identity: string, key: string | undefined): boolean {
  if (!key) return true;
  const header = request.headers.authorization ?? '';
  if (!header.toLowerCase().startsWith('basic ')) return false;
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  return decoded.slice(0, separator) === identity && sameSecret(decoded.slice(separator + 1), key);
}

/**
 * The caller's address, read the way Fastify reads it for the API: the entry the nearest trusted
 * proxy appended to X-Forwarded-For, never one further left that the client could have written.
 */
function clientAddress(request: IncomingMessage, hops: number): string {
  const direct = request.socket?.remoteAddress ?? 'unknown';
  if (hops <= 0) return direct;
  const forwarded = String(request.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const chain = [...forwarded, direct];
  return chain[Math.max(0, chain.length - 1 - hops)] ?? direct;
}

function refuse(socket: Duplex, status: string, extraHeaders = ''): void {
  socket.write(`HTTP/1.1 ${status}\r\n${extraHeaders}Connection: close\r\n\r\n`);
  socket.destroy();
}

/** A path segment, or null when it is not valid percent-encoding. */
function decodeSegment(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export function routeUpgrade(deps: UpgradeDeps): (request: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const { config, codes, gateway, channel } = deps;
  const guard = deps.guard ?? new AccessGuard();

  const openConsole = async (request: IncomingMessage, socket: Duplex, head: Buffer, siteId: string, code: string | null): Promise<void> => {
    if (!codes) return channel.handleUpgrade(request, socket, head, siteId);
    const address = clientAddress(request, config.TRUST_PROXY);
    try {
      const account = await checkCode(code ?? undefined, address, codes, guard);
      if (!canWatchSite(account, siteId)) return refuse(socket, '403 Forbidden');
      channel.handleUpgrade(request, socket, head, siteId);
    } catch (error) {
      const reason = error instanceof AppError ? error.code : 'error';
      if (reason !== 'access_code_required') deps.logger?.warn({ reason, ip: address, path: `${WS_PATH_PREFIX}${siteId}` }, 'console socket refused');
      refuse(socket, error instanceof AppError && error.status === 429 ? '429 Too Many Requests' : '401 Unauthorized');
    }
  };

  return (request, socket, head) => {
    // An exception thrown from an upgrade listener is uncaught and ends the process, so nothing
    // a stranger can put in a URL may throw past this point.
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (path.startsWith(OCPP_PATH_PREFIX)) {
        const identity = decodeSegment(path.slice(OCPP_PATH_PREFIX.length));
        if (identity === null) return refuse(socket, '400 Bad Request');
        if (!chargerAdmitted(request, identity, config.OCPP_AUTH_KEY)) {
          return refuse(socket, '401 Unauthorized', 'WWW-Authenticate: Basic realm="ocpp"\r\n');
        }
        return gateway.handleUpgrade(request, socket, head, identity);
      }

      if (path.startsWith(WS_PATH_PREFIX)) {
        const siteId = decodeSegment(path.slice(WS_PATH_PREFIX.length));
        if (siteId === null) return refuse(socket, '400 Bad Request');
        // A browser cannot put headers on a WebSocket, so the console passes its access code in the URL.
        void openConsole(request, socket, head, siteId, url.searchParams.get('code')).catch(() => socket.destroy());
        return;
      }

      socket.destroy();
    } catch {
      socket.destroy();
    }
  };
}
