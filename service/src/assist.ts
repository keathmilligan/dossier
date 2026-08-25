import type { AppContext } from "./context.js";
import type { AssistRequest, AssistResponse, Item } from "./models.js";
import { keywordHits } from "./policy.js";
import { PROMPT_ASSIST } from "./prompts.js";
import { getPolicy, getTopic, listTopicItems, listTopics } from "./store.js";

interface Retrieved {
  item: Item;
  score: number;
  quote: string | null;
}

export async function runAssist(ctx: AppContext, req: AssistRequest): Promise<AssistResponse> {
  const thread = [req.title ?? "", req.thread_text ?? "", req.selection ?? "", req.draft_box ?? ""]
    .filter(Boolean)
    .join("\n");

  let topicId = req.topic_id ?? null;
  if (!topicId) {
    const picked = pickTopic(ctx, thread);
    if (!picked) {
      return {
        mode: "gap",
        what_i_know: [],
        talking_points: [],
        draft: null,
        cite: null,
        gap: "No topic is a strong match. Pick one.",
        item_ids: [],
        topic_id: null,
        topics: listTopics(ctx.db).map((t) => ({ id: t.id, title: t.title })),
      };
    }
    topicId = picked;
  }

  const retrieved = retrieve(ctx, topicId, thread);
  if (retrieved.length < 2) {
    return {
      mode: "gap",
      what_i_know: retrieved.slice(0, 4).map((r) => r.item.title),
      talking_points: [],
      draft: null,
      cite: null,
      gap: "You do not have enough on this sub-point.",
      item_ids: retrieved.map((r) => r.item.id),
      topic_id: topicId,
    };
  }

  const llm = await draftWithLlm(ctx, topicId, req.venue ?? "generic", thread, retrieved);
  if (!llm) {
    return {
      mode: "gap",
      what_i_know: retrieved.map((r) => r.quote || r.item.title).filter(Boolean) as string[],
      talking_points: retrieved.slice(0, 4).map((r) => r.item.title),
      draft: null,
      cite: null,
      gap: "Language model unavailable. Here is what you already have.",
      item_ids: retrieved.map((r) => r.item.id),
      topic_id: topicId,
    };
  }

  const allowed = new Set(retrieved.map((r) => r.item.id));
  const cited = (llm.item_ids ?? []).filter((id) => allowed.has(id));
  if ((llm.item_ids ?? []).some((id) => !allowed.has(id))) {
    return {
      mode: "gap",
      what_i_know: retrieved.map((r) => r.item.title),
      talking_points: [],
      draft: null,
      cite: null,
      gap: "Draft cited sources that were not retrieved.",
      item_ids: cited,
      topic_id: topicId,
    };
  }

  const citeItem = llm.cite && allowed.has(llm.cite.item_id) ? llm.cite : firstCite(retrieved);
  return {
    mode: llm.mode === "grounded" ? "grounded" : "gap",
    what_i_know: llm.what_i_know ?? [],
    talking_points: llm.talking_points ?? [],
    draft: llm.mode === "grounded" ? (llm.draft ?? null) : null,
    cite: llm.mode === "grounded" ? citeItem : null,
    gap: llm.mode === "grounded" ? null : (llm.gap ?? "You do not have enough on this sub-point."),
    item_ids: cited.length ? cited : retrieved.map((r) => r.item.id),
    topic_id: topicId,
  };
}

function pickTopic(ctx: AppContext, thread: string): string | null {
  let best: { id: string; score: number } | null = null;
  for (const topic of listTopics(ctx.db)) {
    const policy = getPolicy(ctx.db, topic.id);
    if (!policy || policy.include.length === 0) continue;
    const score = keywordHits(thread, policy.include);
    if (score === 0) continue;
    if (!best || score > best.score) best = { id: topic.id, score };
  }
  return best?.id ?? null;
}

function retrieve(ctx: AppContext, topicId: string, thread: string): Retrieved[] {
  const rows = listTopicItems(ctx.db, topicId);
  const q = thread.trim().split(/\s+/).slice(0, 12).join(" OR ");
  const ftsScores = new Map<string, number>();
  if (q) {
    try {
      const hits = ctx.db
        .prepare(`SELECT item_id, rank FROM items_fts WHERE items_fts MATCH ? ORDER BY rank LIMIT 20`)
        .all(escapeFts(q)) as Array<{ item_id: string; rank: number }>;
      for (const h of hits) {
        ftsScores.set(h.item_id, 1 / (1 + Math.abs(h.rank)));
      }
    } catch {
      /* malformed MATCH */
    }
  }

  const scored: Retrieved[] = [];
  for (const item of rows) {
    const hay = `${item.title} ${item.readable_text ?? ""} ${item.highlight_text ?? ""}`;
    const kw = keywordHits(hay, thread.trim().split(/\s+/).filter((w) => w.length >= 3));
    const fts = ftsScores.get(item.id) ?? 0;
    const score = 0.6 * fts + 0.4 * Math.min(1, kw / 4);
    scored.push({
      item,
      score,
      quote: item.highlight_text ?? (item.readable_text ?? "").slice(0, 240) ?? null,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8);
}

function escapeFts(q: string): string {
  return q.replace(/"/g, '""');
}

async function draftWithLlm(
  ctx: AppContext,
  topicId: string,
  venue: string,
  thread: string,
  retrieved: Retrieved[],
): Promise<{
  mode?: string;
  what_i_know?: string[];
  talking_points?: string[];
  draft?: string | null;
  cite?: { item_id: string; url: string; quote: string } | null;
  gap?: string | null;
  item_ids?: string[];
} | null> {
  const topic = getTopic(ctx.db, topicId);
  const extracts = retrieved
    .map((r, i) => {
      const snippet = (r.quote || r.item.readable_text || "").slice(0, 600);
      return `[${i + 1}] id=${r.item.id} url=${r.item.url} title=${r.item.title}\n${snippet}`;
    })
    .join("\n\n");
  const user = [
    `TOPIC: ${topic?.title ?? topicId}`,
    `VENUE: ${venue}`,
    `THREAD:\n${thread.slice(0, 6000)}`,
    `RETRIEVED EXTRACTS:\n${extracts}`,
  ].join("\n\n");
  const result = await ctx.llm.chat({
    system: PROMPT_ASSIST,
    messages: [{ role: "user", content: user }],
    json: true,
  });
  if (!result) return null;
  try {
    const trimmed = result.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(trimmed) as {
      mode?: string;
      what_i_know?: string[];
      talking_points?: string[];
      draft?: string | null;
      cite?: { item_id: string; url: string; quote: string } | null;
      gap?: string | null;
      item_ids?: string[];
    };
  } catch {
    return null;
  }
}

function firstCite(retrieved: Retrieved[]): { item_id: string; url: string; quote: string } | null {
  const r = retrieved[0];
  if (!r) return null;
  return { item_id: r.item.id, url: r.item.url, quote: r.quote || r.item.title };
}
