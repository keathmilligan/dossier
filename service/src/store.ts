import type { Database as Db } from "better-sqlite3";
import type {
  Filing,
  FilingState,
  Item,
  JobKind,
  JobState,
  NodeRow,
  Policy,
  QueueFiling,
  Topic,
  TopicHost,
} from "./models.js";
import { FILING_STATES, QUEUE_LIMIT } from "./models.js";
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

interface JobPayload {
  item_id?: string;
  topic_id?: string;
  topic_ids?: string[];
  title?: string;
  url?: string;
  source?: string;
}

interface JobRow {
  id: string;
  kind: JobKind;
  state: JobState;
  payload: string;
  error: string | null;
  created_at: string;
}

type FilingListRow = Filing & {
  item_title: string;
  url: string;
  readable_text: string | null;
  highlight_text: string | null;
  captured_at: string;
};

export function listQueue(
  db: Db,
  topicId: string,
  states: FilingState[] | null = null,
  limit = QUEUE_LIMIT,
  includeRejected = false,
): QueueFiling[] {
  const cap = Math.min(QUEUE_LIMIT, Math.max(1, limit));
  if (states && states.length > 0 && states.length < FILING_STATES.length) {
    return listQueueFilings(db, topicId, states, cap);
  }
  return listQueueHistory(db, topicId, cap, includeRejected);
}

/** Filtered filing view (Rejected tab). */
export function listQueueFilings(
  db: Db,
  topicId: string,
  states: FilingState[],
  limit = QUEUE_LIMIT,
): QueueFiling[] {
  const wanted = states.length ? states : FILING_STATES;
  const ph = wanted.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT f.*, i.title AS item_title, i.url, i.readable_text, i.highlight_text, i.captured_at
       FROM filings f JOIN items i ON i.id = f.item_id
       WHERE f.topic_id = ? AND f.state IN (${ph})
       ORDER BY i.captured_at DESC
       LIMIT ?`,
    )
    .all(topicId, ...wanted, limit) as FilingListRow[];
  const inflight = inFlightByItem(db, topicId);
  return rows.map((row) => decorateFiling(row, inflight.get(row.item_id)));
}

/** Jobs + filings: processed, queued, and in-flight items from the database. */
export function listQueueHistory(
  db: Db,
  topicId: string,
  limit = QUEUE_LIMIT,
  includeRejected = false,
): QueueFiling[] {
  const byItem = new Map<string, QueueFiling>();
  const inflight = inFlightByItem(db, topicId);

  const jobs = db
    .prepare(
      `SELECT id, kind, state, payload, error, created_at FROM jobs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit * 4) as JobRow[];

  for (const job of jobs) {
    const payload = parseJobPayload(job.payload);
    if (!payload?.item_id || !jobMatchesTopic(job.kind, payload, topicId)) continue;
    if (byItem.has(payload.item_id)) continue;
    const row = rowFromJob(db, topicId, job, payload);
    if (!includeRejected && isRejectedRow(row) && !row.in_flight) continue;
    byItem.set(payload.item_id, row);
  }

  const filings = db
    .prepare(
      `SELECT f.*, i.title AS item_title, i.url, i.readable_text, i.highlight_text, i.captured_at
       FROM filings f JOIN items i ON i.id = f.item_id
       WHERE f.topic_id = ?${includeRejected ? "" : " AND f.state != 'rejected'"}
       ORDER BY i.captured_at DESC
       LIMIT ?`,
    )
    .all(topicId, limit) as FilingListRow[];

  for (const row of filings) {
    const existing = byItem.get(row.item_id);
    if (existing) {
      existing.id = row.id;
      existing.node_id = row.node_id;
      existing.score = row.score;
      existing.rationale = row.rationale ?? existing.rationale;
      existing.rank_in_node = row.rank_in_node;
      existing.pinned = row.pinned;
      existing.verdict = row.verdict;
      existing.item_title = row.item_title || existing.item_title;
      existing.url = row.url || existing.url;
      existing.readable_text = row.readable_text;
      existing.highlight_text = row.highlight_text;
      existing.captured_at = row.captured_at || existing.captured_at;
      if (!existing.in_flight) existing.state = row.state;
      existing.reviewable = !existing.in_flight;
    } else {
      byItem.set(row.item_id, decorateFiling(row, inflight.get(row.item_id)));
    }
  }

  return [...byItem.values()]
    .filter((row) => includeRejected || row.in_flight || !isRejectedRow(row))
    .sort((a, b) => (a.captured_at < b.captured_at ? 1 : a.captured_at > b.captured_at ? -1 : 0))
    .slice(0, limit);
}

function isRejectedRow(row: QueueFiling): boolean {
  return row.state === "rejected" || row.state === "dropped";
}

function decorateFiling(
  row: FilingListRow,
  job?: { kind: JobKind; state: JobState },
): QueueFiling {
  const inFlight = Boolean(job);
  return {
    ...row,
    in_flight: inFlight,
    job_kind: job?.kind ?? null,
    job_state: job?.state ?? null,
    reviewable: !inFlight,
  };
}

function rowFromJob(db: Db, topicId: string, job: JobRow, payload: JobPayload): QueueFiling {
  const item = payload.item_id ? getItem(db, payload.item_id) : undefined;
  const filing = payload.item_id ? getFiling(db, payload.item_id, topicId) : undefined;
  const inFlight = job.state === "queued" || job.state === "running";
  return {
    id: filing?.id ?? job.id,
    item_id: payload.item_id ?? job.id,
    topic_id: topicId,
    node_id: filing?.node_id ?? null,
    state: queueState(job, filing),
    score: filing?.score ?? null,
    rationale: filing?.rationale ?? job.error ?? null,
    rank_in_node: filing?.rank_in_node ?? null,
    pinned: filing?.pinned ?? 0,
    verdict: filing?.verdict ?? null,
    item_title: item?.title || payload.title || "Dropped page",
    url: item?.url || payload.url || "",
    readable_text: item?.readable_text ?? null,
    highlight_text: item?.highlight_text ?? null,
    captured_at: item?.captured_at || job.created_at,
    in_flight: inFlight,
    job_kind: job.kind,
    job_state: job.state,
    reviewable: Boolean(filing) && !inFlight,
  };
}

function queueState(job: JobRow, filing: Filing | undefined): QueueFiling["state"] {
  if (job.state === "queued") return "queued";
  if (job.state === "running") {
    if (job.kind === "embed") return "embedding";
    if (job.kind === "judge") return "judging";
    return "extracting";
  }
  if (job.state === "failed") return "failed";
  return filing?.state ?? "dropped";
}

function parseJobPayload(raw: string): JobPayload | null {
  try {
    return JSON.parse(raw) as JobPayload;
  } catch {
    return null;
  }
}

function jobMatchesTopic(kind: JobKind, payload: JobPayload, topicId: string): boolean {
  if (kind === "judge") return !payload.topic_id || payload.topic_id === topicId;
  if (payload.topic_ids) return payload.topic_ids.includes(topicId);
  return !payload.topic_id || payload.topic_id === topicId;
}

function inFlightByItem(
  db: Db,
  topicId: string,
): Map<string, { kind: JobKind; state: JobState }> {
  const jobs = db
    .prepare("SELECT kind, state, payload FROM jobs WHERE state IN ('queued', 'running')")
    .all() as Array<{ kind: JobKind; state: JobState; payload: string }>;
  const best = new Map<string, { kind: JobKind; state: JobState; rank: number }>();
  for (const job of jobs) {
    const payload = parseJobPayload(job.payload);
    if (!payload?.item_id || !jobMatchesTopic(job.kind, payload, topicId)) continue;
    const rank = (job.state === "running" ? 10 : 0) + (job.kind === "judge" ? 2 : job.kind === "embed" ? 1 : 0);
    const prev = best.get(payload.item_id);
    if (!prev || rank > prev.rank) best.set(payload.item_id, { kind: job.kind, state: job.state, rank });
  }
  return new Map([...best].map(([id, j]) => [id, { kind: j.kind, state: j.state }]));
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
