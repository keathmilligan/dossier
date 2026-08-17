import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { ApiError } from "./errors.js";
import { registerSecurity } from "./security.js";
import { registerRoutes } from "./api.js";
import type { AppContext } from "./context.js";

export function buildApp(ctx: AppContext): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: false });
  registerSecurity(app, { token: ctx.token, port: ctx.config.port });
  registerRoutes(app, ctx);

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({ error: err.code, detail: err.detail });
    }
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;
    return reply.code(status).send({
      error: status === 400 ? "invalid" : "internal",
      detail: e.message,
    });
  });

  return app;
}
