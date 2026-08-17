import Database from "better-sqlite3";
import type { Database as Db } from "better-sqlite3";

export const SCHEMA_VERSION = "1";

const SCHEMA = `
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id                      TEXT PRIMARY KEY,
  title                   TEXT NOT NULL,
  intent                  TEXT NOT NULL DEFAULT '',
  status                  TEXT NOT NULL DEFAULT 'watching'
                            CHECK (status IN ('watching','active','drafting','shelved')),
  venues_json             TEXT NOT NULL DEFAULT '[]',
  auto_accept_confidence  REAL NOT NULL DEFAULT 0.85,
  watching_confirmed      INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  yaml_text    TEXT NOT NULL,
  accepted_at  TEXT NOT NULL,
  UNIQUE (topic_id, version)
);

CREATE TABLE IF NOT EXISTS policy_proposals (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  yaml_text    TEXT NOT NULL,
  diff_text    TEXT NOT NULL,
  thread_id    TEXT,
  created_at   TEXT NOT NULL,
  accepted_at  TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('inbox','section')),
  title      TEXT NOT NULL,
  slug       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  UNIQUE (topic_id, slug)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  topic_ids   TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  paused      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS items (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  url_normalized  TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  referrer        TEXT,
  captured_at     TEXT NOT NULL,
  dwell_ms        INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL CHECK (source IN ('session','watching','manual','pin')),
  session_id      TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  readable_text   TEXT,
  highlight_text  TEXT,
  origin          TEXT NOT NULL DEFAULT 'public'
                    CHECK (origin IN ('public','private'))
);

CREATE INDEX IF NOT EXISTS items_url_norm ON items(url_normalized);

CREATE TABLE IF NOT EXISTS filings (
  id           TEXT PRIMARY KEY,
  item_id      TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  topic_id     TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  node_id      TEXT REFERENCES nodes(id) ON DELETE SET NULL,
  state        TEXT NOT NULL
                 CHECK (state IN ('inbox','proposed','filed','rejected','related')),
  score        REAL,
  rationale    TEXT,
  rank_in_node REAL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  verdict      TEXT CHECK (verdict IN ('keep','demote','reject','reread')),
  UNIQUE (item_id, topic_id)
);

CREATE TABLE IF NOT EXISTS extracts (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('claim','quote','entity','note','architecture')),
  text        TEXT NOT NULL,
  attribution TEXT
);

CREATE TABLE IF NOT EXISTS embeddings (
  id          TEXT PRIMARY KEY,
  owner_type  TEXT NOT NULL CHECK (owner_type IN ('item','policy_include','policy_exclude')),
  owner_id    TEXT NOT NULL,
  model       TEXT NOT NULL,
  dim         INTEGER NOT NULL,
  vec         BLOB NOT NULL,
  UNIQUE (owner_type, owner_id, model)
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  item_id UNINDEXED,
  title,
  readable_text,
  highlight_text,
  tokenize='porter'
);

CREATE TABLE IF NOT EXISTS chat_threads (
  id         TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('setup','policy','brief','reply')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compositions (
  id                  TEXT PRIMARY KEY,
  topic_id            TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  venue               TEXT NOT NULL DEFAULT 'generic',
  thread_url          TEXT,
  draft               TEXT NOT NULL,
  talking_points_json TEXT NOT NULL DEFAULT '[]',
  item_ids_json       TEXT NOT NULL DEFAULT '[]',
  gap                 TEXT,
  kept_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS denylist (
  id       TEXT PRIMARY KEY,
  pattern  TEXT NOT NULL UNIQUE,
  reason   TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('embed','judge','extract')),
  payload     TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'queued'
                CHECK (state IN ('queued','running','done','failed')),
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`;

export function openDb(dbPath: string): Db {
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
