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
  deleteItem,
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
}

interface JudgePayload {
  item_id: string;
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
      maybeDeleteOrphan(ctx, item.id);
    }
    return;
  }
  upsertItemEmbed(ctx.db, item.id, ctx.config.llm.embed_model, vec);

  const survivors: string[] = [];
  for (const topicId of payload.topic_ids) {
    const keep = shouldKeepForTopic(ctx, item.id, topicId, payload.source, vec);
    if (!keep) {
      ctx.db.prepare("DELETE FROM filings WHERE item_id = ? AND topic_id = ?").run(item.id, topicId);
      continue;
    }
    survivors.push(topicId);
    enqueueJob(ctx.db, "judge", { item_id: item.id, topic_id: topicId });
  }

  if (payload.source === "watching" && survivors.length === 0) {
    maybeDeleteOrphan(ctx, item.id);
  }
}

function shouldKeepForTopic(
  ctx: AppContext,
  itemId: string,
  topicId: string,
  source: string,
  pageEmbed: number[],
): boolean {
  if (source === "manual" || source === "pin") return true;
  const policy = acceptedPolicy(ctx.db, topicId);
  if (!policy) return false;
  const doc = parsePolicyYaml(policy.yaml_text);
  const item = getItem(ctx.db, itemId);
  if (!item) return false;
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
  return result.keep;
}

function maybeDeleteOrphan(ctx: AppContext, itemId: string): void {
  const n = (
    ctx.db.prepare("SELECT COUNT(*) AS n FROM filings WHERE item_id = ?").get(itemId) as { n: number }
  ).n;
  if (n === 0) deleteItem(ctx.db, itemId);
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
