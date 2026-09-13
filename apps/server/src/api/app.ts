import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { authenticate, createAccessControl, type AccessControl } from './auth';
import type { ApiContext } from './context';
import { registerFlexRoutes } from './routes/flex';
import { registerMeRoutes } from './routes/me';
import { registerSessionRoutes } from './routes/sessions';
import { registerSiteRoutes } from './routes/sites';
import { registerSystemRoutes } from './routes/system';

/** Every response uses the same envelope, so clients have one shape to handle. */
export const ok = <T>(data: T, meta?: Record<string, unknown>): { ok: true; data: T; meta?: Record<string, unknown> } =>
  meta === undefined ? { ok: true, data } : { ok: true, data, meta };

/** `access` is shared with the socket upgrades, so a wrong code counts the same whichever door it was tried at. */
export async function buildApp(ctx: ApiContext, access: AccessControl = createAccessControl(ctx)): Promise<FastifyInstance> {
  // Trust only the configured number of proxy hops: the address the nearest proxy saw, never an entry the client wrote.
  const hops = ctx.config.TRUST_PROXY;
  const app = Fastify({ logger: false, trustProxy: hops > 0 ? (_address: string, hop: number) => hop < hops : false });
  /**
   * Methods are named rather than left to a default.
   *
   * The default answered a PATCH preflight with "GET,HEAD,POST", so every PATCH from a browser was
   * refused before it was sent -- which is why changing a session from the console had never been
   * possible and the console said to use the API instead. The server had the route the whole time.
   * A list that has to be edited when a verb is added is a smaller cost than one that silently
   * disagrees with the routes behind it.
   */
  const origins = ctx.config.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  await app.register(cors, {
    origin: origins && origins.length > 0 ? origins : true,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH'],
    allowedHeaders: ['content-type', 'authorization', 'x-dev-role', 'x-dev-user', 'x-access-code'],
  });

  // Several endpoints take no body. A client that still sends a JSON content-type should get the
  // action, not a parser error.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.addHook('onRequest', async (request) => {
    if (request.method === 'OPTIONS') return;
    const path = request.url.split('?')[0] ?? '';
    // The host's health check comes with no code, and must still be able to tell the server is up.
    if (path === '/health') return;
    request.principal = await authenticate(request, ctx, access);
  });

  app.setErrorHandler((error, request, reply) => {
    // Who is getting codes wrong, and where, so a lockout can be traced. Never the code itself.
    if (error instanceof AppError && (error.code === 'access_code_rejected' || error.code === 'too_many_attempts')) {
      ctx.logger.warn({ reason: error.code, ip: request.ip, path: request.url.split('?')[0], agent: request.headers['user-agent'] }, 'access code refused');
    }
    if (error instanceof AppError) {
      void reply
        .code(error.status)
        .send({ ok: false, error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    if (error instanceof ZodError) {
      void reply.code(400).send({
        ok: false,
        error: {
          code: 'invalid_request',
          message: 'the request body failed validation',
          details: error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })),
        },
      });
      return;
    }
    // Fastify's own errors (bad JSON, unsupported media type) already know their status.
    const fastifyError = error as { statusCode?: number; code?: string; message?: string };
    const status = fastifyError.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      void reply.code(status).send({
        ok: false,
        error: { code: fastifyError.code ?? 'bad_request', message: fastifyError.message ?? 'bad request' },
      });
      return;
    }
    ctx.logger.error({ err: error, url: request.url }, 'unhandled request error');
    void reply.code(500).send({ ok: false, error: { code: 'internal_error', message: 'something went wrong' } });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      ok: false,
      error: { code: 'not_found', message: `no route for ${request.method} ${request.url}` },
    });
  });

  await registerSystemRoutes(app, ctx);
  await registerMeRoutes(app, ctx);
  await registerSessionRoutes(app, ctx);
  await registerSiteRoutes(app, ctx);
  await registerFlexRoutes(app, ctx);
  return app;
}
