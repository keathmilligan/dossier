import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDb, SCHEMA_VERSION } from "../src/db.js";
import { savePolicy } from "../src/store.js";

describe("openDb", () => {
  it("replaces a v2 database that has no policies.prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "dossier-db-"));
    const path = join(dir, "dossier.sqlite");
    const old = new Database(path);
    old.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE topics (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE policies (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL UNIQUE,
        include_json TEXT NOT NULL DEFAULT '[]',
        exclude_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE filings (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        topic_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('filed','rejected'))
      );
      INSERT INTO meta(key, value) VALUES ('schema_version', '2');
      INSERT INTO topics(id, title, created_at, updated_at) VALUES ('t1', 'old', 'n', 'n');
    `);
    old.close();
    expect(existsSync(path)).toBe(true);

    const db = openDb(path);
    const cols = db.prepare("PRAGMA table_info(policies)").all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name)).toContain("prompt");
    expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({
      value: SCHEMA_VERSION,
    });
    expect(db.prepare("SELECT * FROM topics").all()).toEqual([]);
    db.prepare("INSERT INTO topics(id, title, created_at, updated_at) VALUES ('t', 'n', 'n', 'n')").run();
    expect(savePolicy(db, "t", "keep MV3 notes").prompt).toBe("keep MV3 notes");
  });
});
