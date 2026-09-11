import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../errors';
import { authenticate } from './auth';
import type { ApiContext } from './context';
import { registerFlexRoutes } from './routes/flex';
import { registerMeRoutes } from './routes/me';
import { registerSessionRoutes } from './routes/sessions';
import { registerSiteRoutes } from './routes/sites';
import { registerSystemRoutes } from './routes/system';

/** Every response uses the same envelope, so clients have one shape to handle. */
export const ok = <T>(data: T, meta?: Record<string, unknown>): { ok: true; data: T; meta?: Record<string, unknown> } =>
  meta === undefined ? { ok: true, data } : { ok: true, data, meta };

export async function buildApp(ctx: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.addHook('onRequest', async (request) => {
    if (request.method === 'OPTIONS') return;
    request.principal = await authenticate(request, ctx);
  });

  app.setErrorHandler((error, request, reply) => {
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
