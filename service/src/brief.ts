import type { Database as Db } from "better-sqlite3";

export function renderBrief(
  db: Db,
  topicId: string,
  opts: { includeProposed?: boolean } = {},
): string {
  const topic = db.prepare("SELECT * FROM topics WHERE id = ?").get(topicId) as
    | { title: string; intent: string }
    | undefined;
  if (!topic) return "";

  const states = opts.includeProposed ? ["filed", "proposed"] : ["filed"];
  const placeholders = states.map(() => "?").join(",");
  const nodes = db
    .prepare("SELECT * FROM nodes WHERE topic_id = ? ORDER BY kind = 'inbox', position, title")
    .all(topicId) as Array<{ id: string; title: string; slug: string; kind: string; position: number }>;

  const lines: string[] = [`# ${topic.title}`, ""];
  if (topic.intent) {
    lines.push(topic.intent, "");
  }

  const inbox = nodes.find((n) => n.kind === "inbox");
  const sections = nodes.filter((n) => n.kind === "section");

  for (const node of sections) {
    const items = loadItems(db, topicId, node.id, states, placeholders);
    if (items.length === 0) continue;
    lines.push(`## ${node.title}`);
    for (const item of items) lines.push(...formatItem(item));
    lines.push("");
  }

  if (inbox) {
    const items = loadItems(db, topicId, inbox.id, states, placeholders);
    if (items.length) {
      lines.push("## Unfiled");
      for (const item of items) lines.push(...formatItem(item));
      lines.push("");
    }
  }

  return lines.join("\n").trim() + "\n";
}

interface BriefItem {
  title: string;
  url: string;
  score: number | null;
  rationale: string | null;
  quote: string | null;
}

function loadItems(
  db: Db,
  topicId: string,
  nodeId: string,
  states: string[],
  placeholders: string,
): BriefItem[] {
  return db
    .prepare(
      `SELECT i.title, i.url, f.score, f.rationale, f.pinned, f.rank_in_node, i.captured_at,
              (SELECT e.text FROM extracts e WHERE e.item_id = i.id AND e.kind = 'quote' LIMIT 1) AS quote
       FROM filings f
       JOIN items i ON i.id = f.item_id
       WHERE f.topic_id = ? AND f.node_id = ? AND f.state IN (${placeholders})
       ORDER BY f.pinned DESC, f.rank_in_node DESC, i.captured_at DESC`,
    )
    .all(topicId, nodeId, ...states) as BriefItem[];
}

function formatItem(item: BriefItem): string[] {
  const score = item.score !== null && item.score !== undefined ? ` (${item.score})` : "";
  const blurb = item.quote || item.rationale || "";
  const dash = blurb ? ` — ${blurb}` : "";
  return [`- **${item.title}**${score}${dash}`, `  ${item.url}`];
}
