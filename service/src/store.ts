import type { Database as Db } from "better-sqlite3";
import type { Filing, FilingState, Item, Policy, QueueFiling, Topic, TopicHost } from "./models.js";
import { DEFAULT_QUEUE_STATES, FILING_STATES, QUEUE_LIMIT } from "./models.js";
import { newId, nowIso } from "./ids.js";
import { deleteFts, upsertFts } from "./db.js";
import { hostAllowedByWatchlist } from "./denylist.js";

export function getTopic(db: Db, id: string): Topic | undefined {
  return db.prepare("SELECT * FROM topics WHERE id = ?").get(id) as Topic | undefined;
}

export function listTopics(db: Db): Topic[] {
  return db.prepare("SELECT * FROM topics ORDER BY updated_at DESC").all() as Topic[];
}

export function getPolicy(db: Db, topicId: string): Policy | undefined {
  const row = db.prepare("SELECT * FROM policies WHERE topic_id = ?").get(topicId) as Policy | undefined;
  return row;
}

export function insertEmptyPolicy(db: Db, topicId: string): Policy {
  const now = nowIso();
  const policy: Policy = { id: newId(), topic_id: topicId, prompt: "", updated_at: now };
  db.prepare("INSERT INTO policies(id, topic_id, prompt, updated_at) VALUES (?, ?, '', ?)").run(
    policy.id,
    topicId,
    now,
  );
  return policy;
}

export function savePolicy(db: Db, topicId: string, prompt: string): Policy {
  const now = nowIso();
  const existing = getPolicy(db, topicId);
  if (existing) {
    db.prepare("UPDATE policies SET prompt = ?, updated_at = ? WHERE topic_id = ?").run(prompt, now, topicId);
    return { ...existing, prompt, updated_at: now };
  }
  const policy: Policy = { id: newId(), topic_id: topicId, prompt, updated_at: now };
  db.prepare("INSERT INTO policies(id, topic_id, prompt, updated_at) VALUES (?, ?, ?, ?)").run(
    policy.id,
    topicId,
    prompt,
    now,
  );
  return policy;
}

export function getItemByNormalized(db: Db, urlNormalized: string): Item | undefined {
  return db.prepare("SELECT * FROM items WHERE url_normalized = ?").get(urlNormalized) as Item | undefined;
}

export function getItem(db: Db, id: string): Item | undefined {
  return db.prepare("SELECT * FROM items WHERE id = ?").get(id) as Item | undefined;
}

export function countItems(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
}

export function getFiling(db: Db, itemId: string, topicId: string): Filing | undefined {
  return db.prepare("SELECT * FROM filings WHERE item_id = ? AND topic_id = ?").get(itemId, topicId) as
    | Filing
    | undefined;
}

export function getFilingById(db: Db, id: string): Filing | undefined {
  return db.prepare("SELECT * FROM filings WHERE id = ?").get(id) as Filing | undefined;
}

export function listQueue(
  db: Db,
  topicId: string,
  states: FilingState[] | null = null,
  limit = QUEUE_LIMIT,
  includeRejected = false,
): QueueFiling[] {
  const cap = Math.min(QUEUE_LIMIT, Math.max(1, limit));
  const wanted = states && states.length ? states : includeRejected ? FILING_STATES : DEFAULT_QUEUE_STATES;
  const ph = wanted.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT f.id, f.item_id, f.topic_id, f.state,
              i.title AS item_title, i.url, i.readable_text, i.highlight_text, i.captured_at
       FROM filings f JOIN items i ON i.id = f.item_id
       WHERE f.topic_id = ? AND f.state IN (${ph})
       ORDER BY i.captured_at DESC
       LIMIT ?`,
    )
    .all(topicId, ...wanted, cap) as QueueFiling[];
}

export function listTopicHosts(db: Db, topicId: string): TopicHost[] {
  return db
    .prepare("SELECT * FROM topic_hosts WHERE topic_id = ? ORDER BY added_at")
    .all(topicId) as TopicHost[];
}

export function addTopicHostRow(db: Db, topicId: string, host: string): TopicHost {
  const existing = db
    .prepare("SELECT * FROM topic_hosts WHERE topic_id = ? AND host = ?")
    .get(topicId, host) as TopicHost | undefined;
  if (existing) return existing;
  const row: TopicHost = { id: newId(), topic_id: topicId, host, added_at: nowIso() };
  db.prepare(
    "INSERT INTO topic_hosts(id, topic_id, host, added_at) VALUES (@id, @topic_id, @host, @added_at)",
  ).run(row);
  return row;
}

export function removeTopicHostRow(db: Db, topicId: string, host: string): boolean {
  const res = db.prepare("DELETE FROM topic_hosts WHERE topic_id = ? AND host = ?").run(topicId, host);
  return res.changes > 0;
}

export function topicsForHost(db: Db, host: string): Topic[] {
  const candidates = db
    .prepare(
      `SELECT DISTINCT t.* FROM topics t
       JOIN topic_hosts h ON h.topic_id = t.id`,
    )
    .all() as Topic[];
  return candidates.filter((t) =>
    hostAllowedByWatchlist(
      host,
      listTopicHosts(db, t.id).map((h) => h.host),
    ),
  );
}

export function allWatchedHosts(db: Db): string[] {
  const rows = db.prepare("SELECT DISTINCT host FROM topic_hosts").all() as Array<{ host: string }>;
  return rows.map((r) => r.host);
}

export function listUserDenylist(db: Db): Array<{ id: string; pattern: string; reason: string | null }> {
  return db.prepare("SELECT id, pattern, reason FROM denylist ORDER BY pattern").all() as Array<{
    id: string;
    pattern: string;
    reason: string | null;
  }>;
}

export function saveItem(db: Db, item: Item): void {
  db.prepare(
    `INSERT INTO items(id, url, url_normalized, title, referrer, captured_at, dwell_ms, source, readable_text, highlight_text)
     VALUES (@id, @url, @url_normalized, @title, @referrer, @captured_at, @dwell_ms, @source, @readable_text, @highlight_text)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       dwell_ms = excluded.dwell_ms,
       readable_text = excluded.readable_text,
       highlight_text = excluded.highlight_text`,
  ).run(item);
  upsertFts(db, item);
}

export function deleteItem(db: Db, itemId: string): void {
  deleteFts(db, itemId);
  db.prepare("DELETE FROM items WHERE id = ?").run(itemId);
}

export function ensureFiling(db: Db, itemId: string, topicId: string): Filing {
  const existing = getFiling(db, itemId, topicId);
  if (existing) return existing;
  const filing: Filing = {
    id: newId(),
    item_id: itemId,
    topic_id: topicId,
    state: "queued",
  };
  db.prepare("INSERT INTO filings(id, item_id, topic_id, state) VALUES (@id, @item_id, @topic_id, @state)").run(filing);
  return filing;
}

export function listQueuedFilings(db: Db, limit = 20): Filing[] {
  return db
    .prepare("SELECT * FROM filings WHERE state = 'queued' ORDER BY id LIMIT ?")
    .all(limit) as Filing[];
}

export function setFilingState(db: Db, filingId: string, state: FilingState): void {
  db.prepare("UPDATE filings SET state = ? WHERE id = ?").run(state, filingId);
}

export function listTopicItems(db: Db, topicId: string): Item[] {
  return db
    .prepare(
      `SELECT i.* FROM items i
       JOIN filings f ON f.item_id = i.id
       WHERE f.topic_id = ? AND f.state = 'filed'`,
    )
    .all(topicId) as Item[];
}
