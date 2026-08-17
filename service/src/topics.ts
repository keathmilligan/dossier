import type { AppContext } from "./context.js";
import type { StructurePlanNode, Topic, TopicStatus } from "./models.js";
import { badRequest, notFound } from "./errors.js";
import { newId, nowIso } from "./ids.js";
import { parsePolicyYaml } from "./policy.js";
import { encodeVec } from "./embeddings.js";
import { acceptedPolicy, getTopic, inboxNode, listNodes } from "./store.js";

export function createTopic(ctx: AppContext, title: string): { topic: Topic; thread_id: string } {
  const trimmed = title.trim();
  if (!trimmed) throw badRequest("invalid_title");
  const now = nowIso();
  const topic: Topic = {
    id: newId(),
    title: trimmed,
    intent: "",
    status: "watching",
    venues_json: "[]",
    auto_accept_confidence: ctx.config.capture.auto_accept_confidence,
    watching_confirmed: 0,
    created_at: now,
    updated_at: now,
  };
  ctx.db
    .prepare(
      `INSERT INTO topics(id, title, intent, status, venues_json, auto_accept_confidence, watching_confirmed, created_at, updated_at)
       VALUES (@id, @title, @intent, @status, @venues_json, @auto_accept_confidence, @watching_confirmed, @created_at, @updated_at)`,
    )
    .run(topic);
  inboxNode(ctx.db, topic.id);
  const threadId = newId();
  ctx.db
    .prepare("INSERT INTO chat_threads(id, topic_id, kind, created_at) VALUES (?, ?, 'setup', ?)")
    .run(threadId, topic.id, now);
  return { topic, thread_id: threadId };
}

export function patchTopic(
  ctx: AppContext,
  id: string,
  patch: {
    title?: string;
    intent?: string;
    status?: TopicStatus;
    auto_accept_confidence?: number;
    venues?: unknown;
    watching_confirmed?: boolean;
  },
): Topic {
  const topic = getTopic(ctx.db, id);
  if (!topic) throw notFound("topic_not_found");
  const next = {
    ...topic,
    title: patch.title?.trim() || topic.title,
    intent: patch.intent ?? topic.intent,
    status: patch.status ?? topic.status,
    auto_accept_confidence:
      typeof patch.auto_accept_confidence === "number"
        ? patch.auto_accept_confidence
        : topic.auto_accept_confidence,
    venues_json: patch.venues !== undefined ? JSON.stringify(patch.venues) : topic.venues_json,
    watching_confirmed:
      patch.watching_confirmed === undefined
        ? topic.watching_confirmed
        : patch.watching_confirmed
          ? 1
          : 0,
    updated_at: nowIso(),
  };
  ctx.db
    .prepare(
      `UPDATE topics SET title=@title, intent=@intent, status=@status,
        auto_accept_confidence=@auto_accept_confidence, venues_json=@venues_json,
        watching_confirmed=@watching_confirmed, updated_at=@updated_at
       WHERE id=@id`,
    )
    .run(next);
  return next;
}

export async function acceptPolicy(
  ctx: AppContext,
  topicId: string,
  proposalId: string,
): Promise<{ version: number; policy_id: string }> {
  const topic = getTopic(ctx.db, topicId);
  if (!topic) throw notFound("topic_not_found");
  const proposal = ctx.db
    .prepare("SELECT * FROM policy_proposals WHERE id = ? AND topic_id = ?")
    .get(proposalId, topicId) as { id: string; yaml_text: string; accepted_at: string | null } | undefined;
  if (!proposal) throw notFound("proposal_not_found");
  const doc = parsePolicyYaml(proposal.yaml_text);
  const prev = acceptedPolicy(ctx.db, topicId);
  const version = (prev?.version ?? 0) + 1;
  const policyId = newId();
  const now = nowIso();
  ctx.db
    .prepare(
      "INSERT INTO policies(id, topic_id, version, yaml_text, accepted_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(policyId, topicId, version, proposal.yaml_text, now);
  ctx.db.prepare("UPDATE policy_proposals SET accepted_at = ? WHERE id = ?").run(now, proposalId);
  ctx.db
    .prepare("UPDATE topics SET intent = ?, updated_at = ? WHERE id = ?")
    .run(doc.intent, now, topicId);
  inboxNode(ctx.db, topicId);
  const embeds = Promise.all([
    embedPolicyLines(ctx, policyId, doc.include, "policy_include", "i"),
    embedPolicyLines(ctx, policyId, doc.exclude, "policy_exclude", "e"),
  ]);
  await Promise.race([embeds, new Promise<void>((r) => setTimeout(r, 2000))]);
  return { version, policy_id: policyId };
}

async function embedPolicyLines(
  ctx: AppContext,
  policyId: string,
  lines: string[],
  ownerType: "policy_include" | "policy_exclude",
  tag: "i" | "e",
): Promise<void> {
  const ins = ctx.db.prepare(
    `INSERT INTO embeddings(id, owner_type, owner_id, model, dim, vec)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_type, owner_id, model) DO UPDATE SET vec = excluded.vec, dim = excluded.dim`,
  );
  for (let i = 0; i < lines.length; i++) {
    const vec = await ctx.llm.embed(lines[i]!);
    if (!vec) continue;
    ins.run(
      newId(),
      ownerType,
      `${policyId}:${tag}:${i}`,
      ctx.config.llm.embed_model,
      vec.length,
      encodeVec(vec),
    );
  }
}

export function applyStructure(ctx: AppContext, topicId: string, nodes: StructurePlanNode[]): NodeApplyResult {
  const topic = getTopic(ctx.db, topicId);
  if (!topic) throw notFound("topic_not_found");
  const inbox = inboxNode(ctx.db, topicId);
  const existing = listNodes(ctx.db, topicId).filter((n) => n.kind === "section");
  const keepSlugs = new Set(nodes.map((n) => n.slug));
  const deletedIds: string[] = [];
  for (const node of existing) {
    if (!keepSlugs.has(node.slug)) {
      deletedIds.push(node.id);
    }
  }

  const slugToId = new Map<string, string>();
  slugToId.set("inbox", inbox.id);
  for (const node of existing) {
    if (keepSlugs.has(node.slug)) slugToId.set(node.slug, node.id);
  }

  const ordered = [...nodes].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (let i = 0; i < ordered.length; i++) {
    const plan = ordered[i]!;
    if (!plan.slug || !plan.title) throw badRequest("invalid_node");
    const id = slugToId.get(plan.slug) ?? newId();
    slugToId.set(plan.slug, id);
    const parentId = plan.parent_slug ? (slugToId.get(plan.parent_slug) ?? null) : null;
    const position = plan.position ?? i + 1;
    ctx.db
      .prepare(
        `INSERT INTO nodes(id, topic_id, parent_id, kind, title, slug, position)
         VALUES (?, ?, ?, 'section', ?, ?, ?)
         ON CONFLICT(topic_id, slug) DO UPDATE SET
           title = excluded.title,
           parent_id = excluded.parent_id,
           position = excluded.position`,
      )
      .run(id, topicId, parentId, plan.title, plan.slug, position);
  }

  if (deletedIds.length) {
    const ph = deletedIds.map(() => "?").join(",");
    ctx.db
      .prepare(`UPDATE filings SET node_id = ?, state = CASE WHEN state = 'filed' THEN 'inbox' ELSE state END WHERE node_id IN (${ph})`)
      .run(inbox.id, ...deletedIds);
    ctx.db.prepare(`DELETE FROM nodes WHERE id IN (${ph})`).run(...deletedIds);
  }

  return { nodes: listNodes(ctx.db, topicId) };
}

export interface NodeApplyResult {
  nodes: ReturnType<typeof listNodes>;
}

export function applyVerdict(
  ctx: AppContext,
  filingId: string,
  action: string,
  nodeId?: string,
): void {
  const filing = ctx.db.prepare("SELECT * FROM filings WHERE id = ?").get(filingId) as
    | { id: string; topic_id: string; node_id: string | null; state: string }
    | undefined;
  if (!filing) throw notFound("filing_not_found");
  const inbox = inboxNode(ctx.db, filing.topic_id);
  if (action === "keep") {
    const target = nodeId ?? filing.node_id ?? inbox.id;
    ctx.db
      .prepare("UPDATE filings SET state = 'filed', node_id = ?, verdict = 'keep' WHERE id = ?")
      .run(target, filingId);
    return;
  }
  if (action === "refile") {
    if (!nodeId) throw badRequest("node_required");
    ctx.db
      .prepare("UPDATE filings SET state = 'filed', node_id = ?, verdict = 'keep' WHERE id = ?")
      .run(nodeId, filingId);
    return;
  }
  if (action === "reject") {
    ctx.db
      .prepare("UPDATE filings SET state = 'rejected', verdict = 'reject' WHERE id = ?")
      .run(filingId);
    return;
  }
  if (action === "related") {
    ctx.db.prepare("UPDATE filings SET state = 'related' WHERE id = ?").run(filingId);
    return;
  }
  if (action === "reread") {
    ctx.db.prepare("UPDATE filings SET verdict = 'reread' WHERE id = ?").run(filingId);
    return;
  }
  throw badRequest("invalid_action");
}
