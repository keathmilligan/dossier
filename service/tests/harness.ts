import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { openDb } from "../src/db.js";
import { DEFAULT_CONFIG, type AppConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";
import type { AppContext } from "../src/context.js";
import type { ChatResult } from "../src/models.js";
import type { ChatMessage, LlmClient, ToolSpec } from "../src/ollama.js";
import { createLogger } from "../src/logger.js";

export const TOKEN = "t".repeat(64);
export const EXT_ORIGIN = "chrome-extension://nohjgllifaeekjbodpjlkacopbnflhco";

export interface MockLlmOptions {
  chat?: (opts: {
    system: string;
    messages: ChatMessage[];
    tools?: ToolSpec[];
    json?: boolean;
  }) => ChatResult | null;
  health?: boolean;
}

export function mockLlm(opts: MockLlmOptions = {}): LlmClient {
  return {
    health: async () => opts.health ?? true,
    chat: async (req) =>
      opts.chat
        ? opts.chat(req)
        : {
            content: JSON.stringify({
              mode: "gap",
              what_i_know: [],
              talking_points: [],
              draft: null,
              cite: null,
              gap: "ok",
              item_ids: [],
            }),
          },
  };
}

export function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...over,
    llm: { ...DEFAULT_CONFIG.llm, ...(over.llm ?? {}) },
    capture: { ...DEFAULT_CONFIG.capture, ...(over.capture ?? {}) },
  };
}

export function makeCtx(llm: LlmClient = mockLlm()): AppContext {
  const dir = mkdtempSync(join(tmpdir(), "dossier-"));
  const db = openDb(join(dir, "test.sqlite"));
  return {
    db,
    config: makeConfig(),
    token: TOKEN,
    llm,
    paused: { value: false },
    logger: createLogger(null, { silent: true }),
  };
}

export function makeApp(ctx?: AppContext): { app: FastifyInstance; ctx: AppContext } {
  const c = ctx ?? makeCtx();
  return { app: buildApp(c), ctx: c };
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${TOKEN}`,
    host: "127.0.0.1:18765",
    ...extra,
  };
}

export async function api(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return app.inject({
    method,
    url,
    headers: authHeaders(opts.headers ?? {}),
    payload: opts.body as never,
  });
}
