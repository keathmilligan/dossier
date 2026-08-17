import type { AppContext } from "./context.js";
import type { CaptureBody, Item, ItemOrigin, Topic } from "./models.js";
import { badRequest } from "./errors.js";
import { checkDenylist, hostAllowedByWatchlist } from "./denylist.js";
import { hostOf, normalizeUrl } from "./normalize.js";
import { newId, nowIso } from "./ids.js";
import {
  acceptedPolicy,
  currentSession,
  enqueueJob,
  ensureFiling,
  getItemByNormalized,
  getSession,
  getTopic,
  inboxNode,
  listTopics,
  listUserDenylist,
  saveItem,
} from "./store.js";
import { parsePolicyYaml } from "./policy.js";

export interface CaptureResult {
  item: Item | null;
  filings: Array<{ id: string; topic_id: string }>;
  dropped: boolean;
}

export function ingestCapture(ctx: AppContext, body: CaptureBody): CaptureResult {
  if (body.incognito) {
    throw badRequest("incognito", "incognito tabs are never captured");
  }
  if (!body.url || typeof body.url !== "string") {
    throw badRequest("invalid_url");
  }

  const denylist = checkDenylist(body.url, listUserDenylist(ctx.db));
  const isPin = body.source === "pin";
  if (denylist.blocked && !isPin) {
    throw badRequest("denylisted", denylist.reason);
  }

  const max = ctx.config.capture.max_body_chars;
  let text = body.readable_text ?? "";
  if (text.length > max) text = text.slice(0, max);
  const highlight = body.highlight_text?.trim() || null;
  const min = ctx.config.capture.min_body_chars;
  if (!isPin && !highlight && text.trim().length < min) {
    throw badRequest("too_short", `readable text shorter than ${min} characters`);
  }

  const urlNormalized = normalizeUrl(body.url);
  const topics = resolveTopics(ctx, body, urlNormalized);
  if (topics.length === 0) {
    throw badRequest("no_topic", "no eligible topic for this capture");
  }

  const existing = getItemByNormalized(ctx.db, urlNormalized);
  const origin: ItemOrigin = isPin && denylist.blocked ? "private" : "public";
  const item: Item = existing
    ? {
        ...existing,
        title: body.title?.trim() || existing.title,
        dwell_ms: Math.max(existing.dwell_ms, body.dwell_ms ?? 0),
        readable_text: text || existing.readable_text,
        highlight_text: mergeHighlight(existing.highlight_text, highlight),
        session_id: body.session_id ?? existing.session_id,
      }
    : {
        id: newId(),
        url: body.url,
        url_normalized: urlNormalized,
        title: body.title?.trim() || urlNormalized,
        referrer: body.referrer ?? null,
        captured_at: nowIso(),
        dwell_ms: body.dwell_ms ?? 0,
        source: body.source,
        session_id: body.session_id ?? null,
        readable_text: text || null,
        highlight_text: highlight,
        origin,
      };

  saveItem(ctx.db, item);

  const filings: Array<{ id: string; topic_id: string }> = [];
  for (const topic of topics) {
    const inbox = inboxNode(ctx.db, topic.id);
    const filing = ensureFiling(ctx.db, item.id, topic.id, inbox.id);
    filings.push({ id: filing.id, topic_id: topic.id });
  }

  enqueueJob(ctx.db, "embed", {
    item_id: item.id,
    source: body.source,
    topic_ids: topics.map((t) => t.id),
  });

  return { item, filings, dropped: false };
}

function mergeHighlight(prev: string | null, next: string | null): string | null {
  if (!next) return prev;
  if (!prev) return next;
  if (prev.includes(next)) return prev;
  return `${prev}\n${next}`;
}

function resolveTopics(ctx: AppContext, body: CaptureBody, urlNormalized: string): Topic[] {
  if (body.topic_ids?.length) {
    return body.topic_ids
      .map((id) => getTopic(ctx.db, id))
      .filter((t): t is Topic => Boolean(t));
  }
  if (body.session_id) {
    const session = getSession(ctx.db, body.session_id) ?? currentSession(ctx.db);
    if (!session || session.ended_at) {
      throw badRequest("no_session", "session is not active");
    }
    const ids = JSON.parse(session.topic_ids) as string[];
    return ids.map((id) => getTopic(ctx.db, id)).filter((t): t is Topic => Boolean(t));
  }
  if (body.source === "watching") {
    return watchingTopicsForUrl(ctx, urlNormalized);
  }
  return listTopics(ctx.db).filter((t) => acceptedPolicy(ctx.db, t.id));
}

export function watchingTopicsForUrl(ctx: AppContext, url: string): Topic[] {
  const host = hostOf(url);
  if (!host) return [];
  const out: Topic[] = [];
  for (const topic of listTopics(ctx.db)) {
    if (topic.status !== "watching" && topic.status !== "active") continue;
    if (!topic.watching_confirmed) continue;
    const policy = acceptedPolicy(ctx.db, topic.id);
    if (!policy) continue;
    const doc = parsePolicyYaml(policy.yaml_text);
    if (hostAllowedByWatchlist(host, doc.hosts)) out.push(topic);
  }
  return out;
}
