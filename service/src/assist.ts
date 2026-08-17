import type { AppContext } from "./context.js";
import type { AssistRequest, AssistResponse, Item } from "./models.js";
import { cosine } from "./embeddings.js";
import { cheapFilter } from "./filter.js";
import { hostOf } from "./normalize.js";
import { parsePolicyYaml } from "./policy.js";
import { PROMPT_ASSIST } from "./prompts.js";
import { ingestCapture } from "./capture.js";
import {
  acceptedPolicy,
  getItem,
  getTopic,
  listTopics,
  loadEmbeds,
  loadItemEmbed,
  policyExcludeOwnerIds,
  policyIncludeOwnerIds,
} from "./store.js";

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
    const picked = await pickTopic(ctx, thread);
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

  if (req.pin) {
    ingestCapture(ctx, {
      url: req.url || "https://pinned.local/thread",
      title: req.title ?? "Pinned thread",
      source: "pin",
      topic_ids: [topicId],
      readable_text: (req.selection || req.thread_text || "").slice(
        0,
        ctx.config.capture.max_body_chars,
      ),
      highlight_text: req.selection ?? null,
    });
  }

  const threadEmbed = (await ctx.llm.embed(thread.slice(0, 4000))) ?? null;
  const retrieved = retrieve(
    ctx,
    topicId,
    thread,
    req.include_private === true,
    req.venue ?? "generic",
    threadEmbed,
  );
  const above = retrieved.filter((r) => r.score >= ctx.config.filter.include_min_cosine);

  if (above.length < 2) {
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

  const llm = await draftWithLlm(ctx, topicId, req.venue ?? "generic", thread, above);
  if (!llm) {
    return {
      mode: "gap",
      what_i_know: above.map((r) => r.quote || r.item.title).filter(Boolean) as string[],
      talking_points: above.slice(0, 4).map((r) => r.item.title),
      draft: null,
      cite: null,
      gap: "Language model unavailable. Here is what you already have.",
      item_ids: above.map((r) => r.item.id),
      topic_id: topicId,
    };
  }

  const allowed = new Set(above.map((r) => r.item.id));
  const cited = (llm.item_ids ?? []).filter((id) => allowed.has(id));
  if ((llm.item_ids ?? []).some((id) => !allowed.has(id))) {
    return {
      mode: "gap",
      what_i_know: above.map((r) => r.item.title),
      talking_points: [],
      draft: null,
      cite: null,
      gap: "Draft cited sources that were not retrieved.",
      item_ids: cited,
      topic_id: topicId,
    };
  }

  const citeItem = llm.cite && allowed.has(llm.cite.item_id) ? llm.cite : firstCite(above);
  return {
    mode: llm.mode === "grounded" ? "grounded" : "gap",
    what_i_know: llm.what_i_know ?? [],
    talking_points: llm.talking_points ?? [],
    draft: llm.mode === "grounded" ? (llm.draft ?? null) : null,
    cite: llm.mode === "grounded" ? citeItem : null,
    gap: llm.mode === "grounded" ? null : (llm.gap ?? "You do not have enough on this sub-point."),
    item_ids: cited.length ? cited : above.map((r) => r.item.id),
    topic_id: topicId,
  };
}

async function pickTopic(ctx: AppContext, thread: string): Promise<string | null> {
  const embed = (await ctx.llm.embed(thread.slice(0, 4000))) ?? null;
  let best: { id: string; score: number } | null = null;
  for (const topic of listTopics(ctx.db)) {
    const policy = acceptedPolicy(ctx.db, topic.id);
    if (!policy) continue;
    const doc = parsePolicyYaml(policy.yaml_text);
    const includeIds = policyIncludeOwnerIds(policy.id, doc.include.length);
    const excludeIds = policyExcludeOwnerIds(policy.id, doc.exclude.length);
    const result = cheapFilter({
      title: "",
      host: "",
      text: thread,
      pageEmbed: embed,
      includeEmbeds: loadEmbeds(ctx.db, "policy_include", includeIds, ctx.config.llm.embed_model),
      excludeEmbeds: loadEmbeds(ctx.db, "policy_exclude", excludeIds, ctx.config.llm.embed_model),
      includeTerms: doc.include,
      includeMinCosine: ctx.config.filter.include_min_cosine,
      excludeMargin: ctx.config.filter.exclude_margin,
    });
    if (!best || result.score > best.score) best = { id: topic.id, score: result.score };
  }
  if (!best || best.score < ctx.config.filter.include_min_cosine) return null;
  return best.id;
}

function retrieve(
  ctx: AppContext,
  topicId: string,
  thread: string,
  includePrivate: boolean,
  venue: string,
  threadEmbed: number[] | null = null,
): Retrieved[] {
  const publicVenue = venue !== "email" && venue !== "dm";
  const rows = ctx.db
    .prepare(
      `SELECT i.* FROM items i
       JOIN filings f ON f.item_id = i.id
       WHERE f.topic_id = ? AND f.state != 'rejected'`,
    )
    .all(topicId) as Item[];

  const q = thread.trim().split(/\s+/).slice(0, 12).join(" OR ");
  const ftsScores = new Map<string, number>();
  if (q) {
    try {
      const hits = ctx.db
        .prepare(
          `SELECT item_id, rank FROM items_fts WHERE items_fts MATCH ? ORDER BY rank LIMIT 20`,
        )
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
    if (item.origin === "private" && publicVenue && !includePrivate) continue;
    const itemEmbed = loadItemEmbed(ctx.db, item.id, ctx.config.llm.embed_model);
    const cos = threadEmbed && itemEmbed ? cosine(threadEmbed, itemEmbed) : 0;
    const fts = ftsScores.get(item.id) ?? 0;
    const score = 0.6 * cos + 0.4 * fts;
    const quoteRow = ctx.db
      .prepare("SELECT text FROM extracts WHERE item_id = ? AND kind = 'quote' LIMIT 1")
      .get(item.id) as { text: string } | undefined;
    scored.push({
      item,
      score,
      quote: quoteRow?.text ?? item.highlight_text,
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
  const policy = acceptedPolicy(ctx.db, topicId);
  let voice = "precise, sourced, short";
  if (policy) {
    const doc = parsePolicyYaml(policy.yaml_text);
    voice = (doc.voice as Record<string, string | undefined>)[venue] || doc.voice.default;
  }
  const extracts = retrieved
    .map((r, i) => {
      const snippet = (r.quote || r.item.readable_text || "").slice(0, 600);
      return `[${i + 1}] id=${r.item.id} url=${r.item.url} title=${r.item.title}\n${snippet}`;
    })
    .join("\n\n");
  const user = [
    `TOPIC: ${topic?.title ?? topicId}`,
    `VOICE: ${voice}`,
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

/** Used by tests to inject a thread embedding via the item table path. */
export function retrieveForTest(
  ctx: AppContext,
  topicId: string,
  thread: string,
  includePrivate: boolean,
  venue: string,
  threadEmbed: number[] | null = null,
): Retrieved[] {
  return retrieve(ctx, topicId, thread, includePrivate, venue, threadEmbed);
}
