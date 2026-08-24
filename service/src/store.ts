import type { Database as Db } from "better-sqlite3";
import type {
  Filing,
  Item,
  NodeRow,
  Policy,
  Topic,
  TopicHost,
} from "./models.js";
import { newId, nowIso } from "./ids.js";
import { deleteFts, upsertFts } from "./db.js";
import { decodeVec, encodeVec } from "./embeddings.js";
import { hostAllowedByWatchlist } from "./denylist.js";

export function getTopic(db: Db, id: string): Topic | undefined {
  return db.prepare("SELECT * FROM topics WHERE id = ?").get(id) as Topic | undefined;
}

export function listTopics(db: Db): Topic[] {
  return db.prepare("SELECT * FROM topics ORDER BY updated_at DESC").all() as Topic[];
}

export function acceptedPolicy(db: Db, topicId: string): Policy | undefined {
  return db
    .prepare("SELECT * FROM policies WHERE topic_id = ? ORDER BY version DESC LIMIT 1")
    .get(topicId) as Policy | undefined;
}

export function listNodes(db: Db, topicId: string): NodeRow[] {
  return db
    .prepare("SELECT * FROM nodes WHERE topic_id = ? ORDER BY kind = 'inbox', position, title")
    .all(topicId) as NodeRow[];
}

export function inboxNode(db: Db, topicId: string): NodeRow {
  const row = db
    .prepare("SELECT * FROM nodes WHERE topic_id = ? AND kind = 'inbox'")
    .get(topicId) as NodeRow | undefined;
  if (row) return row;
  const now = nowIso();
  const node: NodeRow = {
    id: newId(),
    topic_id: topicId,
    parent_id: null,
    kind: "inbox",
    title: "Inbox",
    slug: "inbox",
    position: 0,
  };
  db.prepare(
    "INSERT INTO nodes(id, topic_id, parent_id, kind, title, slug, position) VALUES (?, ?, NULL, 'inbox', 'Inbox', 'inbox', 0)",
  ).run(node.id, topicId);
  void now;
  return node;
}

export function getItemByNormalized(db: Db, urlNormalized: string): Item | undefined {
  return db.prepare("SELECT * FROM items WHERE url_normalized = ?").get(urlNormalized) as
    | Item
    | undefined;
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
  const res = db
    .prepare("DELETE FROM topic_hosts WHERE topic_id = ? AND host = ?")
    .run(topicId, host);
  return res.changes > 0;
}

/** Topics whose watched-site list covers `host`. */
export function topicsForHost(db: Db, host: string): Topic[] {
  const candidates = db
    .prepare(
      `SELECT DISTINCT t.* FROM topics t
       JOIN topic_hosts h ON h.topic_id = t.id
       WHERE t.status IN ('watching','active')`,
    )
    .all() as Topic[];
  return candidates.filter((t) =>
    hostAllowedByWatchlist(
      host,
      listTopicHosts(db, t.id).map((h) => h.host),
    ),
  );
}

/** Every host currently watched by any topic, deduplicated. Used by the extension to decide whether a navigation is worth reporting. */
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

export function loadEmbeds(
  db: Db,
  ownerType: string,
  ownerIds: string[],
  model: string,
): number[][] {
  if (ownerIds.length === 0) return [];
  const out: number[][] = [];
  const stmt = db.prepare(
    "SELECT vec FROM embeddings WHERE owner_type = ? AND owner_id = ? AND model = ?",
  );
  for (const id of ownerIds) {
    const row = stmt.get(ownerType, id, model) as { vec: Buffer } | undefined;
    if (row) out.push(decodeVec(row.vec));
  }
  return out;
}

export function loadItemEmbed(db: Db, itemId: string, model: string): number[] | null {
  const row = db
    .prepare("SELECT vec FROM embeddings WHERE owner_type = 'item' AND owner_id = ? AND model = ?")
    .get(itemId, model) as { vec: Buffer } | undefined;
  return row ? decodeVec(row.vec) : null;
}

export function upsertItemEmbed(db: Db, itemId: string, model: string, vec: number[]): void {
  db.prepare(
    `INSERT INTO embeddings(id, owner_type, owner_id, model, dim, vec)
     VALUES (?, 'item', ?, ?, ?, ?)
     ON CONFLICT(owner_type, owner_id, model)
     DO UPDATE SET vec = excluded.vec, dim = excluded.dim`,
  ).run(newId(), itemId, model, vec.length, encodeVec(vec));
}

export function saveItem(db: Db, item: Item): void {
  db.prepare(
    `INSERT INTO items(id, url, url_normalized, title, referrer, captured_at, dwell_ms, source, readable_text, highlight_text, origin)
     VALUES (@id, @url, @url_normalized, @title, @referrer, @captured_at, @dwell_ms, @source, @readable_text, @highlight_text, @origin)
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
  db.prepare("DELETE FROM embeddings WHERE owner_type = 'item' AND owner_id = ?").run(itemId);
  db.prepare("DELETE FROM items WHERE id = ?").run(itemId);
}

export function ensureFiling(db: Db, itemId: string, topicId: string, nodeId: string): Filing {
  const existing = getFiling(db, itemId, topicId);
  if (existing) return existing;
  const filing: Filing = {
    id: newId(),
    item_id: itemId,
    topic_id: topicId,
    node_id: nodeId,
    state: "inbox",
    score: null,
    rationale: null,
    rank_in_node: null,
    pinned: 0,
    verdict: null,
  };
  db.prepare(
    `INSERT INTO filings(id, item_id, topic_id, node_id, state, score, rationale, rank_in_node, pinned, verdict)
     VALUES (@id, @item_id, @topic_id, @node_id, @state, @score, @rationale, @rank_in_node, @pinned, @verdict)`,
  ).run(filing);
  return filing;
}

export function enqueueJob(db: Db, kind: "embed" | "judge" | "extract", payload: unknown): string {
  const id = newId();
  const ts = nowIso();
  db.prepare(
    "INSERT INTO jobs(id, kind, payload, state, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)",
  ).run(id, kind, JSON.stringify(payload), ts, ts);
  return id;
}

export function policyIncludeOwnerIds(policyId: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${policyId}:i:${i}`);
}

export function policyExcludeOwnerIds(policyId: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${policyId}:e:${i}`);
}
