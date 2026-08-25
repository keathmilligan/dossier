import type { AppContext } from "./context.js";
import type { Policy, Topic, TopicHost } from "./models.js";
import { badRequest, notFound } from "./errors.js";
import { newId, nowIso } from "./ids.js";
import { normalizeTerms } from "./policy.js";
import {
  addTopicHostRow,
  deleteItem,
  getFilingById,
  getTopic,
  insertEmptyPolicy,
  listTopicHosts,
  removeTopicHostRow,
  savePolicy,
} from "./store.js";

export function createTopic(ctx: AppContext, title: string): { topic: Topic } {
  const trimmed = title.trim();
  if (!trimmed) throw badRequest("invalid_title");
  const now = nowIso();
  const topic: Topic = {
    id: newId(),
    title: trimmed,
    created_at: now,
    updated_at: now,
  };
  ctx.db.prepare("INSERT INTO topics(id, title, created_at, updated_at) VALUES (@id, @title, @created_at, @updated_at)").run(
    topic,
  );
  insertEmptyPolicy(ctx.db, topic.id);
  ctx.logger.info("topic_created", { topic_id: topic.id, title: topic.title });
  return { topic };
}

export function patchTopic(ctx: AppContext, id: string, patch: { title?: string }): Topic {
  const topic = getTopic(ctx.db, id);
  if (!topic) throw notFound("topic_not_found");
  const next = {
    ...topic,
    title: patch.title?.trim() || topic.title,
    updated_at: nowIso(),
  };
  ctx.db.prepare("UPDATE topics SET title=@title, updated_at=@updated_at WHERE id=@id").run(next);
  return next;
}

export function deleteTopic(ctx: AppContext, id: string): void {
  const topic = getTopic(ctx.db, id);
  if (!topic) throw notFound("topic_not_found");
  const orphans = ctx.db
    .prepare(
      `SELECT f.item_id AS id FROM filings f
       WHERE f.topic_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM filings o WHERE o.item_id = f.item_id AND o.topic_id != ?
         )`,
    )
    .all(id, id) as Array<{ id: string }>;
  for (const item of orphans) deleteItem(ctx.db, item.id);
  ctx.db.prepare("DELETE FROM topics WHERE id = ?").run(id);
  ctx.logger.info("topic_deleted", { topic_id: id, title: topic.title });
}

export function putPolicy(ctx: AppContext, topicId: string, include: unknown, exclude: unknown): Policy {
  const topic = getTopic(ctx.db, topicId);
  if (!topic) throw notFound("topic_not_found");
  const policy = savePolicy(ctx.db, topicId, normalizeTerms(include), normalizeTerms(exclude));
  ctx.db.prepare("UPDATE topics SET updated_at = ? WHERE id = ?").run(policy.updated_at, topicId);
  ctx.logger.info("policy_updated", {
    topic_id: topicId,
    title: topic.title,
    include: policy.include.length,
    exclude: policy.exclude.length,
  });
  return policy;
}

export function addTopicHost(ctx: AppContext, topicId: string, rawHost: string): TopicHost[] {
  const topic = getTopic(ctx.db, topicId);
  if (!topic) throw notFound("topic_not_found");
  const host = normalizeHost(rawHost);
  if (!host) throw badRequest("invalid_host", "not a valid hostname");
  addTopicHostRow(ctx.db, topicId, host);
  ctx.logger.info("site_added", { topic_id: topicId, title: topic.title, host });
  return listTopicHosts(ctx.db, topicId);
}

export function removeTopicHost(ctx: AppContext, topicId: string, rawHost: string): TopicHost[] {
  const topic = getTopic(ctx.db, topicId);
  if (!topic) throw notFound("topic_not_found");
  const host = normalizeHost(rawHost);
  const removed = host ? removeTopicHostRow(ctx.db, topicId, host) : false;
  ctx.logger.info(removed ? "site_removed" : "site_remove_noop", {
    topic_id: topicId,
    title: topic.title,
    host,
  });
  return listTopicHosts(ctx.db, topicId);
}

function normalizeHost(raw: string): string | null {
  const trimmed = (raw || "").trim().toLowerCase();
  if (!trimmed) return null;
  const host = trimmed
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^\*\./, "")
    .replace(/^www\./, "");
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) ? host : null;
}

export function applyVerdict(ctx: AppContext, filingId: string, action: string): void {
  const filing = getFilingById(ctx.db, filingId);
  if (!filing) throw notFound("filing_not_found");
  if (action !== "reject") throw badRequest("invalid_action");
  ctx.db.prepare("UPDATE filings SET state = 'rejected' WHERE id = ?").run(filingId);
}
