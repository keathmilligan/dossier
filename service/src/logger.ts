import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from "node:fs";

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  info(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
}

const MAX_BYTES = 5 * 1024 * 1024; // 5MB per file before rotating
const REDACT_KEYS = /^(token|authorization|bearer|password|passwd|secret)$/i;

export interface LoggerOptions {
  /** Skip stdout/stderr (used by tests so verbose activity logs don't clutter output). */
  silent?: boolean;
  /** Override the rotation threshold in bytes (tests only; defaults to 5MB). */
  maxBytes?: number;
}

/**
 * Creates a leveled logger that writes a human-readable line to stdout/stderr
 * and appends the same line to `logPath` (if provided), rotating the file
 * once it grows past MAX_BYTES (keeping a single `.1` backup).
 *
 * Every line answers: when, what happened, and the specific detail (topic,
 * host, url, reason) needed to understand it without reading source.
 */
export function createLogger(logPath: string | null, opts: LoggerOptions = {}): Logger {
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  function write(level: LogLevel, event: string, details?: Record<string, unknown>): void {
    const line = formatLine(level, event, details);
    if (!opts.silent) {
      if (level === "error") console.error(line);
      else console.log(line);
    }
    if (logPath) appendToFile(logPath, line, maxBytes);
  }

  return {
    info: (event, details) => write("info", event, details),
    warn: (event, details) => write("warn", event, details),
    error: (event, details) => write("error", event, details),
  };
}

function formatLine(level: LogLevel, event: string, details?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const pairs = details ? formatDetails(details) : "";
  return `${ts} [${level.toUpperCase()}] ${event}${pairs ? " " + pairs : ""}`;
}

function formatDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([k]) => !REDACT_KEYS.test(k))
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(" ");
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "-";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const oneLine = s.replace(/\s+/g, " ").trim();
  const clipped = oneLine.length > 300 ? `${oneLine.slice(0, 300)}…` : oneLine;
  return /\s/.test(clipped) ? JSON.stringify(clipped) : clipped;
}

function appendToFile(logPath: string, line: string, maxBytes: number): void {
  try {
    rotateIfNeeded(logPath, maxBytes);
    appendFileSync(logPath, line + "\n", "utf8");
  } catch {
    /* logging must never crash the service */
  }
}

function rotateIfNeeded(logPath: string, maxBytes: number): void {
  if (!existsSync(logPath)) return;
  const size = statSync(logPath).size;
  if (size < maxBytes) return;
  const backup = `${logPath}.1`;
  if (existsSync(backup)) unlinkSync(backup);
  renameSync(logPath, backup);
}
