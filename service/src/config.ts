import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { randomBytes } from "node:crypto";
import { parse, stringify } from "smol-toml";

export interface LlmConfig {
  base_url: string;
  chat_model: string;
  embed_model: string;
  timeout_s: number;
}

export interface CaptureConfig {
  dwell_ms: number;
  min_body_chars: number;
  max_body_chars: number;
  auto_accept_confidence: number;
}

export interface FilterConfig {
  include_min_cosine: number;
  exclude_margin: number;
}

export interface AppConfig {
  listen: string;
  port: number;
  llm: LlmConfig;
  capture: CaptureConfig;
  filter: FilterConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  listen: "127.0.0.1",
  port: 18765,
  llm: {
    base_url: "http://127.0.0.1:11434/v1",
    chat_model: "llama3.2",
    embed_model: "nomic-embed-text",
    timeout_s: 120,
  },
  capture: {
    dwell_ms: 8000,
    min_body_chars: 200,
    max_body_chars: 80000,
    auto_accept_confidence: 0.85,
  },
  filter: {
    include_min_cosine: 0.32,
    exclude_margin: 0.04,
  },
};

export function defaultDataDir(): string {
  if (process.env.DOSSIER_HOME) return process.env.DOSSIER_HOME;
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "dossier");
    case "win32":
      return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "dossier");
    default:
      return join(process.env.XDG_DATA_HOME || join(home, ".local", "share"), "dossier");
  }
}

export interface Paths {
  dataDir: string;
  configPath: string;
  tokenPath: string;
  dbPath: string;
}

export function pathsFor(dataDir = defaultDataDir()): Paths {
  return {
    dataDir,
    configPath: join(dataDir, "config.toml"),
    tokenPath: join(dataDir, "token"),
    dbPath: join(dataDir, "dossier.sqlite"),
  };
}

export function ensureDataDir(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    /* windows */
  }
}

export function loadOrCreateToken(tokenPath: string): string {
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf8").trim();
  }
  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, token, { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(tokenPath, 0o600);
  } catch {
    /* windows */
  }
  return token;
}

function mergeConfig(raw: Record<string, unknown>): AppConfig {
  const llm = (raw.llm ?? {}) as Record<string, unknown>;
  const capture = (raw.capture ?? {}) as Record<string, unknown>;
  const filter = (raw.filter ?? {}) as Record<string, unknown>;
  return {
    listen: typeof raw.listen === "string" ? raw.listen : DEFAULT_CONFIG.listen,
    port: typeof raw.port === "number" ? raw.port : DEFAULT_CONFIG.port,
    llm: {
      base_url: str(llm.base_url, DEFAULT_CONFIG.llm.base_url),
      chat_model: str(llm.chat_model, DEFAULT_CONFIG.llm.chat_model),
      embed_model: str(llm.embed_model, DEFAULT_CONFIG.llm.embed_model),
      timeout_s: num(llm.timeout_s, DEFAULT_CONFIG.llm.timeout_s),
    },
    capture: {
      dwell_ms: num(capture.dwell_ms, DEFAULT_CONFIG.capture.dwell_ms),
      min_body_chars: num(capture.min_body_chars, DEFAULT_CONFIG.capture.min_body_chars),
      max_body_chars: num(capture.max_body_chars, DEFAULT_CONFIG.capture.max_body_chars),
      auto_accept_confidence: num(
        capture.auto_accept_confidence,
        DEFAULT_CONFIG.capture.auto_accept_confidence,
      ),
    },
    filter: {
      include_min_cosine: num(filter.include_min_cosine, DEFAULT_CONFIG.filter.include_min_cosine),
      exclude_margin: num(filter.exclude_margin, DEFAULT_CONFIG.filter.exclude_margin),
    },
  };
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function loadOrCreateConfig(configPath: string): AppConfig {
  if (!existsSync(configPath)) {
    mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
    writeFileSync(configPath, stringify(DEFAULT_CONFIG as unknown as Record<string, unknown>), "utf8");
    return { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm }, capture: { ...DEFAULT_CONFIG.capture }, filter: { ...DEFAULT_CONFIG.filter } };
  }
  const raw = parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  return mergeConfig(raw);
}

export function bindHost(listen: string): string {
  if (listen === "127.0.0.1" || listen === "localhost") return listen;
  return "127.0.0.1";
}
