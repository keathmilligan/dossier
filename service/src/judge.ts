import type { AppContext } from "./context.js";
import type { Filing } from "./models.js";
import { PROMPT_SCOPE } from "./prompts.js";
import { getItem, getPolicy, getTopic, listQueuedFilings, setFilingState } from "./store.js";

const SCOPE_BODY_CHARS = 4000;

const TICK_MS = 3000;
const MAX_BACKOFF_MS = 60_000;

const coolUntil = new Map<string, number>();
const failCount = new Map<string, number>();

export function startJudgeLoop(ctx: AppContext, intervalMs = TICK_MS): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      void tickJudge(ctx).finally(schedule);
    }, intervalMs);
  };
  void tickJudge(ctx).finally(schedule);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

let ticking = false;

export async function tickJudge(ctx: AppContext): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    while (true) {
      const filing = nextEligible(ctx);
      if (!filing) return;
      const decided = await judgeFiling(ctx, filing);
      if (!decided) cool(filing.id);
    }
  } finally {
    ticking = false;
  }
}

function nextEligible(ctx: AppContext): Filing | undefined {
  const now = Date.now();
  return listQueuedFilings(ctx.db).find((f) => (coolUntil.get(f.id) ?? 0) <= now);
}

function cool(id: string): void {
  const n = (failCount.get(id) ?? 0) + 1;
  failCount.set(id, n);
  const wait = Math.min(MAX_BACKOFF_MS, TICK_MS * 2 ** Math.min(n - 1, 4));
  coolUntil.set(id, Date.now() + wait);
}

function clearCool(id: string): void {
  coolUntil.delete(id);
  failCount.delete(id);
}

export async function judgeFiling(ctx: AppContext, filing: Filing): Promise<boolean> {
  const item = getItem(ctx.db, filing.item_id);
  const policy = getPolicy(ctx.db, filing.topic_id);
  const topic = getTopic(ctx.db, filing.topic_id);
  if (!item || !policy || !topic) {
    setFilingState(ctx.db, filing.id, "rejected");
    ctx.logger.info("scope_rejected", { filing_id: filing.id, reason: "missing_row" });
    clearCool(filing.id);
    return true;
  }
  if (!policy.prompt.trim()) {
    ctx.logger.info("scope_retry", { filing_id: filing.id, reason: "empty_prompt" });
    return false;
  }

  const body = (item.readable_text || item.highlight_text || "").slice(0, SCOPE_BODY_CHARS);
  const user = [
    `PROMPT:\n${policy.prompt}`,
    `TITLE: ${item.title}`,
    `URL: ${item.url}`,
    `BODY:\n${body}`,
    `Return JSON {"in_scope": true or false}.`,
  ].join("\n\n");

  let parsed: boolean | null = null;
  let snippet = "";
  try {
    const first = await askScope(ctx, user);
    parsed = first.parsed;
    snippet = first.snippet;
    if (parsed === null) {
      const second = await askScope(
        ctx,
        `PROMPT: ${policy.prompt}\nTITLE: ${item.title}\nReturn JSON {"in_scope": true or false}.`,
      );
      parsed = second.parsed;
      snippet = second.snippet || snippet;
    }
  } catch (err) {
    ctx.logger.info("scope_retry", {
      filing_id: filing.id,
      reason: err instanceof Error ? err.message : "llm_error",
    });
    return false;
  }
  if (parsed === null) {
    ctx.logger.info("scope_retry", {
      filing_id: filing.id,
      reason: "unparseable",
      snippet,
    });
    return false;
  }
  const state = parsed ? "filed" : "rejected";
  setFilingState(ctx.db, filing.id, state);
  clearCool(filing.id);
  ctx.logger.info(parsed ? "scope_filed" : "scope_rejected", {
    filing_id: filing.id,
    topic_id: topic.id,
    title: item.title,
  });
  return true;
}

async function askScope(
  ctx: AppContext,
  user: string,
): Promise<{ parsed: boolean | null; snippet: string }> {
  const result = await ctx.llm.chat({
    system: PROMPT_SCOPE,
    messages: [{ role: "user", content: user }],
    json: true,
  });
  if (!result) return { parsed: null, snippet: "" };
  return { parsed: parseScope(result.content), snippet: snip(result.content) };
}

export function parseScope(raw: string | undefined | null): boolean | null {
  if (!raw?.trim()) return null;
  const text = stripFence(raw);
  const direct = readFlag(tryJson(text));
  if (direct !== null) return direct;
  const embedded = text.match(/\{[\s\S]*\}/);
  if (embedded) {
    const fromObj = readFlag(tryJson(embedded[0]));
    if (fromObj !== null) return fromObj;
  }
  if (/^(true|yes|keep|include|accept)\b/i.test(text)) return true;
  if (/^(false|no|drop|reject|exclude)\b/i.test(text)) return false;
  return null;
}

function stripFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/m, "")
    .trim();
}

function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function readFlag(doc: unknown): boolean | null {
  if (typeof doc === "boolean") return doc;
  if (!doc || typeof doc !== "object") return null;
  const o = doc as Record<string, unknown>;
  for (const key of ["in_scope", "inScope", "include", "keep", "accept"]) {
    const v = asBool(o[key]);
    if (v !== null) return v;
  }
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === 1) return true;
  if (v === 0) return false;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (["true", "yes", "keep", "include", "accept", "1"].includes(s)) return true;
  if (["false", "no", "drop", "reject", "exclude", "0"].includes(s)) return false;
  return null;
}

function snip(s: string, n = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}
