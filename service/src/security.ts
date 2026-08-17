import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { unauthorized } from "./errors.js";

export function allowedHosts(port: number): Set<string> {
  return new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
}

export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return origin.startsWith("chrome-extension://");
}

export function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerFrom(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}

export function registerSecurity(
  app: FastifyInstance,
  opts: { token: string; port: number },
): void {
  const hosts = allowedHosts(opts.port);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const host = (req.headers.host ?? "").split(",")[0]!.trim();
    if (!hosts.has(host)) {
      throw unauthorized("invalid host");
    }

    if (req.method === "OPTIONS") {
      const origin = header(req, "origin");
      if (origin && !originAllowed(origin)) {
        throw unauthorized("invalid origin");
      }
      if (origin) {
        reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Vary", "Origin");
      }
      reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      reply.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      reply.header("Access-Control-Max-Age", "600");
      return reply.code(204).send();
    }

    const origin = header(req, "origin");
    if (!originAllowed(origin)) {
      throw unauthorized("invalid origin");
    }
    if (origin) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }

    const token = bearerFrom(header(req, "authorization"));
    if (!tokenMatches(token, opts.token)) {
      throw unauthorized();
    }
  });
}

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}
