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
  applyStructure,
  applyVerdict,
  createTopic,
  patchTopic,
} from "./topics.js";
import {
  acceptedPolicy,
  currentSession,
  getSession,
  getTopic,
  listNodes,
  listTopics,
  listUserDenylist,
} from "./store.js";
import { newId, nowIso } from "./ids.js";
import type { AssistRequest, CaptureBody, StructurePlanNode } from "./models.js";

export function registerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/health", async () => {
    const llm = await ctx.llm.health();
    return { ok: true, llm, db: true, paused: ctx.paused.value };
  });

  app.post("/pause", async () => {
    ctx.paused.value = true;
    return { paused: true };
  });

  app.post("/resume", async () => {
    ctx.paused.value = false;
    return { paused: false };
  });

  app.get("/topics", async () => {
    return { topics: listTopics(ctx.db) };
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
      topic,
      policy: policy ?? null,
      nodes: listNodes(ctx.db, id),
      pending_proposal: latestProposal(ctx, id),
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
      watching_confirmed:
        body.watching_confirmed === undefined ? undefined : Boolean(body.watching_confirmed),
    });
    return { topic };
  });

  app.delete("/topics/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!getTopic(ctx.db, id)) throw notFound("topic_not_found");
    ctx.db.prepare("DELETE FROM topics WHERE id = ?").run(id);
    return reply.code(204).send();
  });

  app.get("/topics/:id/queue", async (req) => {
    const { id } = req.params as { id: string };
    if (!getTopic(ctx.db, id)) throw notFound("topic_not_found");
    const q = req.query as { states?: string };
    const states = (q.states ?? "inbox,proposed").split(",").map((s) => s.trim());
    const ph = states.map(() => "?").join(",");
    const rows = ctx.db
      .prepare(
        `SELECT f.*, i.title AS item_title, i.url, i.readable_text, i.highlight_text, i.captured_at
         FROM filings f JOIN items i ON i.id = f.item_id
         WHERE f.topic_id = ? AND f.state IN (${ph})
         ORDER BY i.captured_at ASC`,
      )
      .all(id, ...states);
    return { filings: rows, nodes: listNodes(ctx.db, id) };
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

  app.post("/sessions", async (req) => {
    const body = asObj(req.body);
    const topicIds = Array.isArray(body.topic_ids) ? (body.topic_ids as string[]) : [];
    if (!topicIds.length) throw badRequest("topic_ids_required");
    for (const tid of topicIds) {
      if (!getTopic(ctx.db, tid)) throw notFound("topic_not_found");
      if (!acceptedPolicy(ctx.db, tid)) throw badRequest("no_policy", "accept a policy before recording");
    }
    const existing = currentSession(ctx.db);
    if (existing) {
      ctx.db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(nowIso(), existing.id);
    }
    const id = newId();
    ctx.db
      .prepare("INSERT INTO sessions(id, topic_ids, started_at, paused) VALUES (?, ?, ?, 0)")
      .run(id, JSON.stringify(topicIds), nowIso());
    return { session: getSession(ctx.db, id) };
  });

  app.get("/sessions/current", async () => {
    return { session: currentSession(ctx.db) ?? null, paused: ctx.paused.value };
  });

  app.post("/sessions/:id/pause", async (req) => {
    const session = requireSession(ctx, (req.params as { id: string }).id);
    ctx.db.prepare("UPDATE sessions SET paused = 1 WHERE id = ?").run(session.id);
    ctx.paused.value = true;
    return { session: getSession(ctx.db, session.id), paused: true };
  });

  app.post("/sessions/:id/resume", async (req) => {
    const session = requireSession(ctx, (req.params as { id: string }).id);
    ctx.db.prepare("UPDATE sessions SET paused = 0 WHERE id = ?").run(session.id);
    ctx.paused.value = false;
    return { session: getSession(ctx.db, session.id), paused: false };
  });

  app.post("/sessions/:id/stop", async (req) => {
    const session = requireSession(ctx, (req.params as { id: string }).id);
    ctx.db.prepare("UPDATE sessions SET ended_at = ?, paused = 0 WHERE id = ?").run(nowIso(), session.id);
    return { session: getSession(ctx.db, session.id) };
  });

  app.post("/capture", async (req) => {
    if (ctx.paused.value) throw badRequest("paused", "capture is paused");
    const result = ingestCapture(ctx, req.body as CaptureBody);
    void processQueue(ctx);
    return result;
  });

  app.post("/filings/:id/verdict", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    applyVerdict(ctx, id, String(body.action ?? ""), optStr(body.node_id));
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

function requireSession(ctx: AppContext, id: string) {
  const session = getSession(ctx.db, id);
  if (!session || session.ended_at) throw notFound("session_not_found");
  return session;
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

type TopicStatus = import("./models.js").TopicStatus;
