import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import { randomBytes } from "node:crypto";
import { parse, stringify } from "smol-toml";

export interface LlmConfig {
  base_url: string;
  chat_model: string;
  timeout_s: number;
}

export interface CaptureConfig {
  dwell_ms: number;
  min_body_chars: number;
  max_body_chars: number;
}

export interface AppConfig {
  listen: string;
  port: number;
  llm: LlmConfig;
  capture: CaptureConfig;
}

export const DEFAULT_CONFIG: AppConfig = {
  listen: "127.0.0.1",
  port: 18765,
  llm: {
    base_url: "http://127.0.0.1:11434/v1",
    chat_model: "llama3.2",
    timeout_s: 120,
  },
  capture: {
    dwell_ms: 8000,
    min_body_chars: 200,
    max_body_chars: 80000,
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

/** User-editable files only (`config.toml`). */
export function defaultConfigDir(): string {
  if (process.env.DOSSIER_CONFIG) return process.env.DOSSIER_CONFIG;
  const home = homedir();
  switch (platform()) {
    case "win32":
      return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "dossier");
    default:
      return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "dossier");
  }
}

export interface Paths {
  dataDir: string;
  configDir: string;
  configPath: string;
  tokenPath: string;
  dbPath: string;
  logPath: string;
}

export function pathsFor(opts: { dataDir?: string; configDir?: string } = {}): Paths {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const configDir = opts.configDir ?? defaultConfigDir();
  return {
    dataDir,
    configDir,
    configPath: join(configDir, "config.toml"),
    tokenPath: join(dataDir, "token"),
    dbPath: join(dataDir, "dossier.sqlite"),
    logPath: join(dataDir, "dossier.log"),
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
  return {
    listen: typeof raw.listen === "string" ? raw.listen : DEFAULT_CONFIG.listen,
    port: typeof raw.port === "number" ? raw.port : DEFAULT_CONFIG.port,
    llm: {
      base_url: str(llm.base_url, DEFAULT_CONFIG.llm.base_url),
      chat_model: str(llm.chat_model, DEFAULT_CONFIG.llm.chat_model),
      timeout_s: num(llm.timeout_s, DEFAULT_CONFIG.llm.timeout_s),
    },
    capture: {
      dwell_ms: num(capture.dwell_ms, DEFAULT_CONFIG.capture.dwell_ms),
      min_body_chars: num(capture.min_body_chars, DEFAULT_CONFIG.capture.min_body_chars),
      max_body_chars: num(capture.max_body_chars, DEFAULT_CONFIG.capture.max_body_chars),
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
    return { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm }, capture: { ...DEFAULT_CONFIG.capture } };
  }
  const raw = parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  return mergeConfig(raw);
}

export function bindHost(listen: string): string {
  if (listen === "127.0.0.1" || listen === "localhost") return listen;
  return "127.0.0.1";
}
