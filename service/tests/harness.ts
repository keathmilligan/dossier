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
import { hashEmbed } from "../src/embeddings.js";
import { processQueue } from "../src/jobs.js";

export const TOKEN = "t".repeat(64);
export const EXT_ORIGIN = "chrome-extension://nohjgllifaeekjbodpjlkacopbnflhco";

export interface MockLlmOptions {
  embed?: (text: string) => number[] | null;
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
    embed: async (text) => (opts.embed ? opts.embed(text) : hashEmbed(text)),
    chat: async (req) =>
      opts.chat
        ? opts.chat(req)
        : { content: JSON.stringify({ include: true, node_slug: null, score: 0.4, rationale: "ok", extracts: [] }) },
  };
}

export function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    ...DEFAULT_CONFIG,
    ...over,
    llm: { ...DEFAULT_CONFIG.llm, ...(over.llm ?? {}) },
    capture: { ...DEFAULT_CONFIG.capture, ...(over.capture ?? {}) },
    filter: { ...DEFAULT_CONFIG.filter, ...(over.filter ?? {}) },
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
  };
}

export function makeApp(ctx?: AppContext): { app: FastifyInstance; ctx: AppContext } {
  const c = ctx ?? makeCtx();
  return { app: buildApp(c), ctx: c };
}

export async function drain(ctx: AppContext): Promise<void> {
  await processQueue(ctx, 100);
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
  method: "GET" | "POST" | "PATCH" | "DELETE",
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

export const SAMPLE_POLICY = `topic: local capture
intent: Notes on MV3 capture and localhost bridges
include:
  - Manifest V3 capture
  - localhost bridge security
exclude:
  - Microsoft Recall explainers
rank:
  - implementation notes first
extract:
  - architecture claims
voice:
  default: precise and sourced
  hn: short, one link
deploy:
  - hn
hosts:
  - example.com
  - news.ycombinator.com
  - github.com
`;
