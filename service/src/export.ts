import type { Database as Db } from "better-sqlite3";
import { renderBrief } from "./brief.js";
import { nowIso } from "./ids.js";

export function exportMarkdown(db: Db, topicId: string): string {
  const topic = db.prepare("SELECT title FROM topics WHERE id = ?").get(topicId) as
    | { title: string }
    | undefined;
  const policy = db
    .prepare("SELECT version FROM policies WHERE topic_id = ? ORDER BY version DESC LIMIT 1")
    .get(topicId) as { version: number } | undefined;
  const preamble = [
    "---",
    `title: ${yamlEscape(topic?.title ?? "")}`,
    `exported_at: ${nowIso()}`,
    `policy_version: ${policy?.version ?? 0}`,
    "---",
    "",
  ].join("\n");
  return preamble + renderBrief(db, topicId);
}

function yamlEscape(s: string): string {
  if (/[:#\n"]/.test(s)) return JSON.stringify(s);
  return s;
}
