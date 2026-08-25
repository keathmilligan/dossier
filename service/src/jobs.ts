import type { AppContext } from "./context.js";
import type { JudgeResult } from "./models.js";
import { cheapFilter } from "./filter.js";
import { mapJudgeToFiling, parseJudgeJson } from "./judge.js";
import { hostOf } from "./normalize.js";
import { parsePolicyYaml } from "./policy.js";
import { PROMPT_JUDGE } from "./prompts.js";
import { newId, nowIso } from "./ids.js";
import {
  acceptedPolicy,
  enqueueJob,
  getFiling,
  getItem,
  inboxNode,
  listNodes,
  loadEmbeds,
  policyExcludeOwnerIds,
  policyIncludeOwnerIds,
  upsertItemEmbed,
} from "./store.js";

interface EmbedPayload {
  item_id: string;
  source: string;
  topic_ids: string[];
  title?: string;
  url?: string;
}

interface JudgePayload {
  item_id: string;
  title?: string;
  url?: string;
  topic_id: string;
}

export async function processQueue(ctx: AppContext, max = 50): Promise<number> {
  let n = 0;
  while (n < max) {
    const job = claimNext(ctx);
    if (!job) break;
    n += 1;
    try {
      await runJob(ctx, job);
      finish(ctx, job.id, "done", null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const payload = JSON.parse(job.payload) as { retries?: number };
      if ((payload.retries ?? 0) < 1 && job.kind !== "judge") {
        payload.retries = (payload.retries ?? 0) + 1;
        finish(ctx, job.id, "failed", msg);
        enqueueJob(ctx.db, job.kind, payload);
      } else {
        finish(ctx, job.id, "failed", msg);
      }
    }
  }
  return n;
}

function claimNext(ctx: AppContext): { id: string; kind: "embed" | "judge" | "extract"; payload: string } | undefined {
  const row = ctx.db
    .prepare("SELECT id, kind, payload FROM jobs WHERE state = 'queued' ORDER BY created_at LIMIT 1")
    .get() as { id: string; kind: "embed" | "judge" | "extract"; payload: string } | undefined;
  if (!row) return undefined;
  ctx.db
    .prepare("UPDATE jobs SET state = 'running', updated_at = ? WHERE id = ?")
    .run(nowIso(), row.id);
  return row;
}

function finish(ctx: AppContext, id: string, state: "done" | "failed", error: string | null): void {
  ctx.db
    .prepare("UPDATE jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(state, error, nowIso(), id);
}

async function runJob(
  ctx: AppContext,
  job: { kind: "embed" | "judge" | "extract"; payload: string },
): Promise<void> {
  if (job.kind === "embed") {
    await runEmbed(ctx, JSON.parse(job.payload) as EmbedPayload);
    return;
  }
  if (job.kind === "judge") {
    await runJudge(ctx, JSON.parse(job.payload) as JudgePayload);
    return;
  }
}

async function runEmbed(ctx: AppContext, payload: EmbedPayload): Promise<void> {
  const item = getItem(ctx.db, payload.item_id);
  if (!item) return;
  const text = `${item.title}\n${item.readable_text ?? ""}`.slice(0, 8000);
  const vec = await ctx.llm.embed(text);
  if (!vec) {
    if (payload.source === "watching") {
      for (const topicId of payload.topic_ids) {
        rejectFiltered(ctx, item, topicId, "embed_failed");
      }
    }
    return;
  }
  upsertItemEmbed(ctx.db, item.id, ctx.config.llm.embed_model, vec);

  for (const topicId of payload.topic_ids) {
    const decision = shouldKeepForTopic(ctx, item.id, topicId, payload.source, vec);
    if (!decision.keep) {
      rejectFiltered(ctx, item, topicId, "filtered", decision);
      continue;
    }
    enqueueJob(ctx.db, "judge", {
      item_id: item.id,
      topic_id: topicId,
      title: item.title,
      url: item.url,
    });
  }
}

function shouldKeepForTopic(
  ctx: AppContext,
  itemId: string,
  topicId: string,
  source: string,
  pageEmbed: number[],
): { keep: boolean; include_score?: number; exclude_score?: number; score?: number } {
  if (source === "manual" || source === "pin") return { keep: true };
  const policy = acceptedPolicy(ctx.db, topicId);
  if (!policy) return { keep: false };
  const doc = parsePolicyYaml(policy.yaml_text);
  const item = getItem(ctx.db, itemId);
  if (!item) return { keep: false };
  const includeIds = policyIncludeOwnerIds(policy.id, doc.include.length);
  const excludeIds = policyExcludeOwnerIds(policy.id, doc.exclude.length);
  const result = cheapFilter({
    title: item.title,
    host: hostOf(item.url) ?? "",
    text: item.readable_text ?? "",
    pageEmbed,
    includeEmbeds: loadEmbeds(ctx.db, "policy_include", includeIds, ctx.config.llm.embed_model),
    excludeEmbeds: loadEmbeds(ctx.db, "policy_exclude", excludeIds, ctx.config.llm.embed_model),
    includeTerms: doc.include,
    includeMinCosine: ctx.config.filter.include_min_cosine,
    excludeMargin: ctx.config.filter.exclude_margin,
  });
  return result;
}

function rejectFiltered(
  ctx: AppContext,
  item: { id: string; url: string },
  topicId: string,
  reason: string,
  scores?: { include_score?: number; exclude_score?: number; score?: number },
): void {
  ctx.db
    .prepare("UPDATE filings SET state = 'rejected', rationale = ? WHERE item_id = ? AND topic_id = ?")
    .run(reason, item.id, topicId);
  ctx.logger.info("capture_dropped", {
    url: item.url,
    source: "watching",
    reason,
    topic_id: topicId,
    item_id: item.id,
    include_score: scores?.include_score,
    exclude_score: scores?.exclude_score,
    score: scores?.score,
  });
}

/** Re-run the cheap filter + judge for filings that were dropped by an older, too-strict filter. */
export function requeueFilteredFilings(ctx: AppContext): number {
  const rows = ctx.db
    .prepare(
      `SELECT f.item_id, f.topic_id, i.title, i.url, i.source
       FROM filings f JOIN items i ON i.id = f.item_id
       WHERE f.state = 'rejected' AND f.rationale IN ('filtered', 'embed_failed')`,
    )
    .all() as Array<{ item_id: string; topic_id: string; title: string; url: string; source: string }>;
  if (rows.length === 0) return 0;
  const byItem = new Map<string, { title: string; url: string; source: string; topic_ids: string[] }>();
  for (const row of rows) {
    const cur = byItem.get(row.item_id) ?? {
      title: row.title,
      url: row.url,
      source: row.source,
      topic_ids: [],
    };
    cur.topic_ids.push(row.topic_id);
    byItem.set(row.item_id, cur);
  }
  ctx.db
    .prepare(
      `UPDATE filings SET state = 'inbox', rationale = NULL
       WHERE state = 'rejected' AND rationale IN ('filtered', 'embed_failed')`,
    )
    .run();
  for (const [itemId, payload] of byItem) {
    enqueueJob(ctx.db, "embed", {
      item_id: itemId,
      source: payload.source,
      topic_ids: payload.topic_ids,
      title: payload.title,
      url: payload.url,
    });
  }
  ctx.logger.info("filings_requeued", { count: byItem.size });
  return byItem.size;
}

async function runJudge(ctx: AppContext, payload: JudgePayload): Promise<void> {
  const item = getItem(ctx.db, payload.item_id);
  if (!item) return;
  const policy = acceptedPolicy(ctx.db, payload.topic_id);
  const nodes = listNodes(ctx.db, payload.topic_id);
  const inbox = inboxNode(ctx.db, payload.topic_id);
  const topic = ctx.db.prepare("SELECT auto_accept_confidence FROM topics WHERE id = ?").get(
    payload.topic_id,
  ) as { auto_accept_confidence: number } | undefined;
  const filing = getFiling(ctx.db, payload.item_id, payload.topic_id);
  if (!filing) return;

  let parsed: JudgeResult | null = null;
  if (policy) {
    const outline = nodes
      .filter((n) => n.kind === "section")
      .map((n) => `- ${n.slug}: ${n.title}`)
      .join("\n");
    const user = [
      "POLICY:\n",
      policy.yaml_text,
      "\nOUTLINE:\n",
      outline || "(inbox only)",
      "\nPAGE:\n",
      `url: ${item.url}\n`,
      `title: ${item.title}\n`,
      (item.readable_text ?? "").slice(0, 12000),
    ].join("");
    const result = await ctx.llm.chat({
      system: PROMPT_JUDGE,
      messages: [{ role: "user", content: user }],
      json: true,
    });
    parsed = result ? parseJudgeJson(result.content) : null;
  }

  const mapped = mapJudgeToFiling(
    parsed,
    nodes,
    topic?.auto_accept_confidence ?? 0.85,
    inbox.id,
  );
  ctx.db
    .prepare(
      `UPDATE filings SET state = ?, node_id = ?, score = ?, rationale = ?, rank_in_node = ?
       WHERE id = ?`,
    )
    .run(mapped.state, mapped.node_id, mapped.score, mapped.rationale, mapped.rank_in_node, filing.id);

  if (parsed?.extracts?.length) {
    const ins = ctx.db.prepare(
      "INSERT INTO extracts(id, item_id, kind, text, attribution) VALUES (?, ?, ?, ?, ?)",
    );
    for (const ex of parsed.extracts) {
      if (!ex.text) continue;
      const kind = ["claim", "quote", "entity", "note", "architecture"].includes(ex.kind)
        ? ex.kind
        : "note";
      ins.run(newId(), item.id, kind, ex.text, ex.attribution ?? null);
    }
  }
}
