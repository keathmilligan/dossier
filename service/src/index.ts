#!/usr/bin/env node
import {
  bindHost,
  ensureDataDir,
  loadOrCreateConfig,
  loadOrCreateToken,
  migrateLegacyConfig,
  pathsFor,
} from "./config.js";
import { openDb, getMeta, setMeta } from "./db.js";
import { OllamaClient } from "./ollama.js";
import { buildApp } from "./app.js";
import { processQueue } from "./jobs.js";
import type { AppContext } from "./context.js";

async function main(): Promise<void> {
  const paths = pathsFor();
  ensureDataDir(paths.dataDir);
  ensureDataDir(paths.configDir);
  migrateLegacyConfig(paths);
  const config = loadOrCreateConfig(paths.configPath);
  const token = loadOrCreateToken(paths.tokenPath);
  const db = openDb(paths.dbPath);
  const llm = new OllamaClient({
    baseUrl: config.llm.base_url,
    chatModel: config.llm.chat_model,
    embedModel: config.llm.embed_model,
    timeoutMs: config.llm.timeout_s * 1000,
  });
  const paused = { value: getMeta(db, "paused") === "1" };
  const ctx: AppContext = { db, config, token, llm, paused };
  const app = buildApp(ctx);
  const host = bindHost(config.listen);
  const port = config.port;

  const tick = setInterval(() => {
    void processQueue(ctx).catch(() => undefined);
  }, 1500);

  const close = async () => {
    clearInterval(tick);
    setMeta(db, "paused", ctx.paused.value ? "1" : "0");
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());

  await app.listen({ host, port });
  console.log(`dossierd listening on http://${host}:${port}`);
  console.log(`config    ${paths.configPath}`);
  console.log(`data dir  ${paths.dataDir}`);
  console.log(`database  ${paths.dbPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
