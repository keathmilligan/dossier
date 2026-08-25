import type { FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { badRequest, notFound } from "./errors.js";
import { ingestCapture } from "./capture.js";
import { runAssist } from "./assist.js";
import { chatTopic, createProposal } from "./chat.js";
import { renderBrief } from "./brief.js";
import { exportMarkdown } from "./export.js";
import { processQueue } from "./jobs.js";
import {
  acceptPolicy,
  addTopicHost,
  applyStructure,
  applyVerdict,
  createTopic,
  deleteTopic,
  patchTopic,
  removeTopicHost,
} from "./topics.js";
import {
  acceptedPolicy,
  allWatchedHosts,
  getTopic,
  listNodes,
  listQueue,
  listTopicHosts,
  listTopics,
  listUserDenylist,
} from "./store.js";
import { newId, nowIso } from "./ids.js";
import type { AssistRequest, CaptureBody, FilingState, StructurePlanNode } from "./models.js";
import { FILING_STATES, QUEUE_LIMIT } from "./models.js";

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/health", async () => {
    const llm = await ctx.llm.health();
    return { ok: true, llm, db: true, paused: ctx.paused.value };
  });

  app.post("/pause", async () => {
    ctx.paused.value = true;
    ctx.logger.info("capture_paused");
    return { paused: true };
  });

  app.post("/resume", async () => {
    ctx.paused.value = false;
    ctx.logger.info("capture_resumed");
    return { paused: false };
  });

  app.get("/hosts", async () => {
    return { hosts: allWatchedHosts(ctx.db) };
  });

  app.get("/topics", async () => {
    const topics = listTopics(ctx.db).map((t) => ({
      ...t,
      has_policy: Boolean(acceptedPolicy(ctx.db, t.id)),
    }));
    return { topics };
  });

  app.post("/topics", async (req) => {
    const body = asObj(req.body);
    const { topic, thread_id } = createTopic(ctx, String(body.title ?? ""));
    return { topic, thread_id, nodes: listNodes(ctx.db, topic.id) };
  });

  app.get("/topics/:id", async (req) => {
    const { id } = req.params as { id: string };
    const topic = getTopic(ctx.db, id);
    if (!topic) throw notFound("topic_not_found");
    const policy = acceptedPolicy(ctx.db, id);
    return {
      topic: { ...topic, has_policy: Boolean(policy) },
      policy: policy ?? null,
      nodes: listNodes(ctx.db, id),
      pending_proposal: latestProposal(ctx, id),
      hosts: listTopicHosts(ctx.db, id),
    };
  });

  app.patch("/topics/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    const topic = patchTopic(ctx, id, {
      title: optStr(body.title),
      intent: optStr(body.intent),
      status: optStr(body.status) as TopicStatus | undefined,
      auto_accept_confidence: optNum(body.auto_accept_confidence),
      venues: body.venues,
    });
    return { topic };
  });

  app.get("/topics/:id/hosts", async (req) => {
    const { id } = req.params as { id: string };
    if (!getTopic(ctx.db, id)) throw notFound("topic_not_found");
    return { hosts: listTopicHosts(ctx.db, id) };
  });

  app.post("/topics/:id/hosts", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    const hosts = addTopicHost(ctx, id, String(body.host ?? ""));
    return { hosts };
  });

  app.delete("/topics/:id/hosts/:host", async (req) => {
    const { id, host } = req.params as { id: string; host: string };
    const hosts = removeTopicHost(ctx, id, decodeURIComponent(host));
    return { hosts };
  });

  app.delete("/topics/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    deleteTopic(ctx, id);
    return reply.code(204).send();
  });

  app.get("/topics/:id/queue", async (req) => {
    const { id } = req.params as { id: string };
    if (!getTopic(ctx.db, id)) throw notFound("topic_not_found");
    const q = req.query as { states?: string; limit?: string; include_rejected?: string };
    const states = q.states ? parseFilingStates(q.states) : null;
    const limit = parseQueueLimit(q.limit);
    const includeRejected = q.include_rejected === "1";
    return { filings: listQueue(ctx.db, id, states, limit, includeRejected), nodes: listNodes(ctx.db, id) };
  });

  app.post("/topics/:id/chat", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    return chatTopic(
      ctx,
      id,
      String(body.message ?? ""),
      optStr(body.thread_id),
      (optStr(body.kind) as "setup") ?? "setup",
    );
  });

  app.post("/topics/:id/policy/propose", async (req) => {
    const { id } = req.params as { id: string };
    if (!getTopic(ctx.db, id)) throw notFound("topic_not_found");
    const body = asObj(req.body);
    const proposal = createProposal(ctx, id, null, String(body.yaml_text ?? body.yaml ?? ""));
    return { proposal };
  });

  app.post("/topics/:id/policy/accept", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    const result = await acceptPolicy(ctx, id, String(body.proposal_id ?? ""));
    return result;
  });

  app.post("/topics/:id/structure/apply", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    const nodes = (body.nodes ?? []) as StructurePlanNode[];
    return applyStructure(ctx, id, nodes);
  });

  app.get("/topics/:id/brief", async (req) => {
    const { id } = req.params as { id: string };
    if (!getTopic(ctx.db, id)) throw notFound("topic_not_found");
    const q = req.query as { proposed?: string };
    return { markdown: renderBrief(ctx.db, id, { includeProposed: q.proposed === "1" }) };
  });

  app.get("/topics/:id/export.md", async (req, reply) => {
    const { id } = req.params as { id: string };
    const topic = getTopic(ctx.db, id);
    if (!topic) throw notFound("topic_not_found");
    const md = exportMarkdown(ctx.db, id);
    const filename = `${slugify(topic.title)}.md`;
    return reply
      .header("content-type", "text/markdown; charset=utf-8")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .send(md);
  });

  app.post("/capture", async (req) => {
    if (ctx.paused.value) {
      const body = req.body as CaptureBody;
      ctx.logger.info("capture_dropped", { url: body?.url, source: body?.source, reason: "paused" });
      throw badRequest("paused", "capture is paused");
    }
    const result = ingestCapture(ctx, req.body as CaptureBody);
    void processQueue(ctx);
    return result;
  });

  app.post("/filings/:id/verdict", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    const action = String(body.action ?? "");
    applyVerdict(ctx, id, action, optStr(body.node_id));
    ctx.logger.info("filing_verdict", { filing_id: id, action });
    return { ok: true };
  });

  app.post("/assist", async (req) => {
    return runAssist(ctx, req.body as AssistRequest);
  });

  app.post("/assist/pin", async (req) => {
    return runAssist(ctx, { ...(req.body as AssistRequest), pin: true });
  });

  app.post("/compositions", async (req) => {
    const body = asObj(req.body);
    const topicId = String(body.topic_id ?? "");
    if (!getTopic(ctx.db, topicId)) throw notFound("topic_not_found");
    const id = newId();
    ctx.db
      .prepare(
        `INSERT INTO compositions(id, topic_id, venue, thread_url, draft, talking_points_json, item_ids_json, gap, kept_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        topicId,
        String(body.venue ?? "generic"),
        optStr(body.thread_url) ?? null,
        String(body.draft ?? ""),
        JSON.stringify(body.talking_points ?? []),
        JSON.stringify(body.item_ids ?? []),
        optStr(body.gap) ?? null,
        nowIso(),
      );
    return { id };
  });

  app.get("/denylist", async () => {
    return { patterns: listUserDenylist(ctx.db) };
  });

  app.post("/denylist", async (req) => {
    const body = asObj(req.body);
    const pattern = String(body.pattern ?? "").trim();
    if (!pattern) throw badRequest("pattern_required");
    const id = newId();
    ctx.db
      .prepare("INSERT INTO denylist(id, pattern, reason) VALUES (?, ?, ?)")
      .run(id, pattern, optStr(body.reason) ?? null);
    return { id, pattern };
  });

  app.delete("/denylist/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    ctx.db.prepare("DELETE FROM denylist WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  app.get("/jobs/drain", async () => {
    const n = await processQueue(ctx, 100);
    return { processed: n };
  });
}

function latestProposal(ctx: AppContext, topicId: string) {
  return (
    (ctx.db
      .prepare(
        "SELECT id, yaml_text, diff_text, created_at, accepted_at FROM policy_proposals WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(topicId) as Record<string, unknown> | undefined) ?? null
  );
}

function asObj(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  return body as Record<string, unknown>;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function optNum(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topic";
}

function parseFilingStates(raw?: string): FilingState[] {
  if (!raw?.trim()) return [...FILING_STATES];
  const allowed = new Set<string>(FILING_STATES);
  const states = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is FilingState => allowed.has(s));
  return states.length ? states : [...FILING_STATES];
}

function parseQueueLimit(raw?: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return QUEUE_LIMIT;
  return Math.min(QUEUE_LIMIT, Math.max(1, Math.floor(n)));
}

type TopicStatus = import("./models.js").TopicStatus;
