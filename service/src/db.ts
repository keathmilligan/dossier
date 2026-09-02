import { existsSync, unlinkSync } from "node:fs";
import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

export const SCHEMA_VERSION = "3";

const SCHEMA = `
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL UNIQUE REFERENCES topics(id) ON DELETE CASCADE,
  prompt     TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topic_hosts (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  host       TEXT NOT NULL,
  added_at   TEXT NOT NULL,
  UNIQUE (topic_id, host)
);

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  url_normalized  TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  referrer        TEXT,
  captured_at     TEXT NOT NULL,
  dwell_ms        INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL CHECK (source IN ('watching','manual')),
  readable_text   TEXT,
  highlight_text  TEXT
);

CREATE INDEX IF NOT EXISTS items_url_norm ON items(url_normalized);

CREATE TABLE IF NOT EXISTS filings (
  id        TEXT PRIMARY KEY,
  item_id   TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  topic_id  TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  state     TEXT NOT NULL CHECK (state IN ('queued','filed','rejected')),
  UNIQUE (item_id, topic_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  item_id UNINDEXED,
  title,
  readable_text,
  highlight_text,
  tokenize='porter'
);

CREATE TABLE IF NOT EXISTS denylist (
  id       TEXT PRIMARY KEY,
  pattern  TEXT NOT NULL UNIQUE,
  reason   TEXT
);
`;

export function openDb(dbPath: string): Db {
  if (dbPath !== ":memory:" && existsSync(dbPath) && !fileMatchesSchema(dbPath)) {
    discardDbFile(dbPath);
  }
  let db = connect(dbPath);
  if (schemaReady(db)) return db;
  db.close();
  if (dbPath === ":memory:") throw new Error("in-memory schema mismatch");
  discardDbFile(dbPath);
  if (existsSync(dbPath)) {
    throw new Error(
      `Could not replace outdated database ${dbPath}. Stop dossierd and delete that file.`,
    );
  }
  db = connect(dbPath);
  if (!schemaReady(db)) throw new Error(`failed to create schema ${SCHEMA_VERSION}`);
  return db;
}

function connect(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?)").run(SCHEMA_VERSION);
  }
  return db;
}

function schemaReady(db: Db): boolean {
  const version = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  if (version?.value !== SCHEMA_VERSION) return false;
  const cols = db.prepare("PRAGMA table_info(policies)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "prompt")) return false;
  const filing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'filings'").get() as
    | { sql: string }
    | undefined;
  return Boolean(filing?.sql.includes("queued"));
}

function fileMatchesSchema(dbPath: string): boolean {
  try {
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      return schemaReady(probe);
    } finally {
      probe.close();
    }
  } catch {
    return false;
  }
}

function discardDbFile(dbPath: string): void {
  for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try {
      unlinkSync(p);
    } catch {
      /* missing */
    }
  }
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function upsertFts(
  db: Db,
  item: { id: string; title: string; readable_text: string | null; highlight_text: string | null },
): void {
  db.prepare("DELETE FROM items_fts WHERE item_id = ?").run(item.id);
  db.prepare(
    "INSERT INTO items_fts(item_id, title, readable_text, highlight_text) VALUES (?, ?, ?, ?)",
  ).run(item.id, item.title ?? "", item.readable_text ?? "", item.highlight_text ?? "");
}

export function deleteFts(db: Db, itemId: string): void {
  db.prepare("DELETE FROM items_fts WHERE item_id = ?").run(itemId);
}
