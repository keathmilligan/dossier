import type { FastifyInstance } from "fastify";
import type { AppContext } from "./context.js";
import { badRequest, notFound } from "./errors.js";
import { ingestCapture } from "./capture.js";
import { tickJudge } from "./judge.js";
import { runAssist } from "./assist.js";
import { addTopicHost, applyVerdict, createTopic, deleteTopic, patchTopic, putPolicy, removeTopicHost } from "./topics.js";
import {
  allWatchedHosts,
  getPolicy,
  getTopic,
  listQueue,
  listTopicHosts,
  listTopics,
  listUserDenylist,
} from "./store.js";
import { newId } from "./ids.js";
import type { AssistRequest, CaptureBody, FilingState } from "./models.js";
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
      hosts: listTopicHosts(ctx.db, t.id),
    }));
    return { topics };
  });

  app.post("/topics", async (req) => {
    const body = asObj(req.body);
    const { topic } = createTopic(ctx, String(body.title ?? ""));
    return { topic, policy: getPolicy(ctx.db, topic.id) };
  });

  app.get("/topics/:id", async (req) => {
    const { id } = req.params as { id: string };
    const topic = getTopic(ctx.db, id);
    if (!topic) throw notFound("topic_not_found");
    return {
      topic,
      policy: getPolicy(ctx.db, id) ?? { prompt: "" },
      hosts: listTopicHosts(ctx.db, id),
    };
  });

  app.patch("/topics/:id", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    const topic = patchTopic(ctx, id, { title: optStr(body.title) });
    return { topic };
  });

  app.put("/topics/:id/policy", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    const policy = putPolicy(ctx, id, body.prompt);
    return { policy };
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
    return { filings: listQueue(ctx.db, id, states, limit, includeRejected) };
  });

  app.post("/capture", async (req) => {
    if (ctx.paused.value) {
      const body = req.body as CaptureBody;
      ctx.logger.info("capture_dropped", { url: body?.url, source: body?.source, reason: "paused" });
      throw badRequest("paused", "capture is paused");
    }
    const result = ingestCapture(ctx, req.body as CaptureBody);
    if (!result.dropped) void tickJudge(ctx);
    return result;
  });

  app.post("/filings/:id/verdict", async (req) => {
    const { id } = req.params as { id: string };
    const body = asObj(req.body);
    const action = String(body.action ?? "");
    applyVerdict(ctx, id, action);
    ctx.logger.info("filing_verdict", { filing_id: id, action });
    return { ok: true };
  });

  app.post("/assist", async (req) => {
    return runAssist(ctx, req.body as AssistRequest);
  });

  app.get("/denylist", async () => {
    return { patterns: listUserDenylist(ctx.db) };
  });

  app.post("/denylist", async (req) => {
    const body = asObj(req.body);
    const pattern = String(body.pattern ?? "").trim();
    if (!pattern) throw badRequest("pattern_required");
    const id = newId();
    ctx.db.prepare("INSERT INTO denylist(id, pattern, reason) VALUES (?, ?, ?)").run(id, pattern, optStr(body.reason) ?? null);
    return { id, pattern };
  });

  app.delete("/denylist/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    ctx.db.prepare("DELETE FROM denylist WHERE id = ?").run(id);
    return reply.code(204).send();
  });
}

function asObj(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return {};
  return body as Record<string, unknown>;
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
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
