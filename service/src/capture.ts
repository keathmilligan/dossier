import type { AppContext } from "./context.js";
import type { CaptureBody, Item, Topic } from "./models.js";
import { badRequest } from "./errors.js";
import { checkDenylist } from "./denylist.js";
import { hostOf, normalizeUrl } from "./normalize.js";
import { newId, nowIso } from "./ids.js";
import { matchesPolicy } from "./policy.js";
import {
  ensureFiling,
  getItemByNormalized,
  getPolicy,
  getTopic,
  listUserDenylist,
  saveItem,
  topicsForHost,
} from "./store.js";

export interface CaptureResult {
  item: Item | null;
  filings: Array<{ id: string; topic_id: string }>;
  dropped: boolean;
}

export function ingestCapture(ctx: AppContext, body: CaptureBody): CaptureResult {
  const host = body.url ? hostOf(body.url) : null;
  const log = (event: string, extra?: Record<string, unknown>) =>
    ctx.logger.info(event, { url: body.url, host, source: body.source, ...extra });
  const logDrop = (reason: string, extra?: Record<string, unknown>) =>
    ctx.logger.info("capture_dropped", { url: body.url, host, source: body.source, reason, ...extra });

  if (body.incognito) {
    logDrop("incognito");
    throw badRequest("incognito", "incognito tabs are never captured");
  }
  if (!body.url || typeof body.url !== "string") {
    throw badRequest("invalid_url");
  }

  const denylist = checkDenylist(body.url, listUserDenylist(ctx.db));
  if (denylist.blocked) {
    logDrop("denylisted", { pattern: denylist.reason });
    throw badRequest("denylisted", denylist.reason);
  }

  const max = ctx.config.capture.max_body_chars;
  let text = body.readable_text ?? "";
  if (text.length > max) text = text.slice(0, max);
  const highlight = body.highlight_text?.trim() || null;
  const min = ctx.config.capture.min_body_chars;
  if (!highlight && text.trim().length < min) {
    logDrop("too_short", { chars: text.trim().length, min });
    throw badRequest("too_short", `readable text shorter than ${min} characters`);
  }

  const urlNormalized = normalizeUrl(body.url);
  const topics = resolveTopics(ctx, body, urlNormalized, `${body.title ?? ""} ${text}`);
  if (topics.length === 0) {
    logDrop("no_topic");
    return { item: null, filings: [], dropped: true };
  }

  const existing = getItemByNormalized(ctx.db, urlNormalized);
  const item: Item = existing
    ? {
        ...existing,
        title: body.title?.trim() || existing.title,
        dwell_ms: Math.max(existing.dwell_ms, body.dwell_ms ?? 0),
        readable_text: text || existing.readable_text,
        highlight_text: mergeHighlight(existing.highlight_text, highlight),
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
        readable_text: text || null,
        highlight_text: highlight,
      };

  saveItem(ctx.db, item);

  const filings: Array<{ id: string; topic_id: string }> = [];
  for (const topic of topics) {
    const filing = ensureFiling(ctx.db, item.id, topic.id);
    filings.push({ id: filing.id, topic_id: topic.id });
  }

  log("capture_ingested", {
    item_id: item.id,
    title: item.title,
    topics: topics.map((t) => t.title),
  });

  return { item, filings, dropped: false };
}

function mergeHighlight(prev: string | null, next: string | null): string | null {
  if (!next) return prev;
  if (!prev) return next;
  if (prev.includes(next)) return prev;
  return `${prev}\n${next}`;
}

function resolveTopics(ctx: AppContext, body: CaptureBody, urlNormalized: string, hay: string): Topic[] {
  const candidates = body.topic_ids?.length
    ? body.topic_ids.map((id) => getTopic(ctx.db, id)).filter((t): t is Topic => Boolean(t))
    : watchingTopicsForUrl(ctx, urlNormalized);
  return candidates.filter((topic) => {
    const policy = getPolicy(ctx.db, topic.id);
    if (!policy) return false;
    return matchesPolicy(body.title ?? "", hay, policy.include, policy.exclude);
  });
}

export function watchingTopicsForUrl(ctx: AppContext, url: string): Topic[] {
  const host = hostOf(url);
  if (!host) return [];
  return topicsForHost(ctx.db, host);
}
