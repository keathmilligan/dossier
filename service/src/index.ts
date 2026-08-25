#!/usr/bin/env node
import { bindHost, ensureDataDir, loadOrCreateConfig, loadOrCreateToken, pathsFor } from "./config.js";
import { openDb, getMeta, setMeta } from "./db.js";
import { OllamaClient } from "./ollama.js";
import { buildApp } from "./app.js";
import { createLogger } from "./logger.js";
import type { AppContext } from "./context.js";

async function main(): Promise<void> {
  const paths = pathsFor();
  ensureDataDir(paths.dataDir);
  ensureDataDir(paths.configDir);
  const config = loadOrCreateConfig(paths.configPath);
  const token = loadOrCreateToken(paths.tokenPath);
  const db = openDb(paths.dbPath);
  const logger = createLogger(paths.logPath);
  const llm = new OllamaClient({
    baseUrl: config.llm.base_url,
    chatModel: config.llm.chat_model,
    timeoutMs: config.llm.timeout_s * 1000,
  });
  const paused = { value: getMeta(db, "paused") === "1" };
  const ctx: AppContext = { db, config, token, llm, paused, logger };
  const app = buildApp(ctx);
  const host = bindHost(config.listen);
  const port = config.port;

  const close = async () => {
    setMeta(db, "paused", ctx.paused.value ? "1" : "0");
    logger.info("service_stopped");
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void close());
  process.on("SIGTERM", () => void close());

  await app.listen({ host, port });
  logger.info("service_started", {
    url: `http://${host}:${port}`,
    config: paths.configPath,
    data_dir: paths.dataDir,
    database: paths.dbPath,
    log: paths.logPath,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
