import type { Database as Db } from "better-sqlite3";
import type { AppConfig } from "./config.js";
import type { LlmClient } from "./ollama.js";

export interface AppContext {
  db: Db;
  config: AppConfig;
  token: string;
  llm: LlmClient;
  paused: { value: boolean };
}
