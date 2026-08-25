import { describe, expect, it } from "vitest";
import { api, authHeaders, makeApp, makeCtx, mockLlm, TOKEN } from "./harness.js";
import { addTopicHost, applyVerdict, createTopic, putPolicy, removeTopicHost } from "../src/topics.js";
import { ingestCapture } from "../src/capture.js";
import { countItems, getTopic, listTopicHosts } from "../src/store.js";
import { newId } from "../src/ids.js";
import { QUEUE_LIMIT } from "../src/models.js";

describe("capture_auth", () => {
  it("rejects missing token and evil origin", async () => {
    const { app } = makeApp();
    const noTok = await app.inject({
      method: "GET",
      url: "/health",
      headers: { host: "127.0.0.1:18765" },
    });
    expect(noTok.statusCode).toBe(401);

    const evil = await app.inject({
      method: "POST",
      url: "/capture",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        host: "127.0.0.1:18765",
        origin: "https://evil.test",
      },
      payload: { url: "https://example.com/a", source: "manual", readable_text: "x".repeat(250) },
    });
    expect(evil.statusCode).toBe(401);

    const ok = await app.inject({
      method: "GET",
      url: "/health",
      headers: authHeaders({ origin: "chrome-extension://abc" }),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ok).toBe(true);
    expect(ok.headers.connection).toBe("close");
  });
});

describe("capture_incognito", () => {
  it("rejects incognito", async () => {
    const { app, ctx } = makeApp();
    seedReady(ctx);
    const res = await api(app, "POST", "/capture", {
      body: {
        url: "https://example.com/a",
        source: "manual",
        readable_text: "x".repeat(250),
        incognito: true,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("incognito");
  });
});

describe("capture_match", () => {
  it("files a watched page that hits include and drops one that does not", () => {
    const ctx = makeCtx();
    const { topic } = seedReady(ctx);

    ingestCapture(ctx, {
      url: "https://example.com/mv3",
      title: "Manifest V3 capture notes",
      source: "watching",
      readable_text: "implementation notes on Manifest V3 capture ".repeat(10),
    });
    expect(countItems(ctx.db)).toBe(1);
    const kept = ctx.db.prepare("SELECT state FROM filings").get() as { state: string };
    expect(kept.state).toBe("filed");

    ctx.db.prepare("DELETE FROM filings").run();
    ctx.db.prepare("DELETE FROM items").run();
    ctx.db.prepare("DELETE FROM items_fts").run();

    const miss = ingestCapture(ctx, {
      url: "https://example.com/cooking",
      title: "cooking",
      source: "watching",
      readable_text: "totally unrelated page body about cooking ".repeat(10),
    });
    expect(miss.dropped).toBe(true);
    expect(countItems(ctx.db)).toBe(0);

    putPolicy(ctx, topic.id, [], []);
    const empty = ingestCapture(ctx, {
      url: "https://example.com/mv3-again",
      title: "Manifest V3 capture notes",
      source: "watching",
      readable_text: "implementation notes on Manifest V3 capture ".repeat(10),
    });
    expect(empty.dropped).toBe(true);
  });

  it("drops a page that hits an exclude term", () => {
    const ctx = makeCtx();
    seedReady(ctx, { include: ["Manifest V3"], exclude: ["Recall"] });
    const miss = ingestCapture(ctx, {
      url: "https://example.com/recall",
      title: "Manifest V3 and Microsoft Recall",
      source: "watching",
      readable_text: "Manifest V3 capture compared to Microsoft Recall ".repeat(8),
    });
    expect(miss.dropped).toBe(true);
    expect(countItems(ctx.db)).toBe(0);
  });
});

describe("topic_hosts", () => {
  it("lets you add and remove sites without a filled-in policy", () => {
    const ctx = makeCtx();
    const { topic } = createTopic(ctx, "Local capture");
    const afterAdd = addTopicHost(ctx, topic.id, "https://www.arxiv.org/list");
    expect(afterAdd.map((h) => h.host)).toContain("arxiv.org");
    const afterRemove = removeTopicHost(ctx, topic.id, "arxiv.org");
    expect(afterRemove.map((h) => h.host)).not.toContain("arxiv.org");
  });
});

describe("policy_api", () => {
  it("creates an empty policy and applies include/exclude immediately", async () => {
    const { app, ctx } = makeApp();
    const created = await api(app, "POST", "/topics", { body: { title: "Local capture" } });
    expect(created.statusCode).toBe(200);
    const topic = created.json().topic as { id: string };
    expect(created.json().policy).toEqual(expect.objectContaining({ include: [], exclude: [] }));

    const put = await api(app, "PUT", `/topics/${topic.id}/policy`, {
      body: { include: ["  MV3  ", "MV3", "localhost"], exclude: ["Recall"] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().policy.include).toEqual(["MV3", "localhost"]);
    expect(put.json().policy.exclude).toEqual(["Recall"]);

    const got = await api(app, "GET", `/topics/${topic.id}`);
    expect(got.json().policy.include).toEqual(["MV3", "localhost"]);
    expect(listTopicHosts(ctx.db, topic.id)).toEqual([]);
  });
});

describe("hosts_api", () => {
  it("adds/lists/removes over HTTP without requiring include terms", async () => {
    const { app, ctx } = makeApp();
    const { topic } = createTopic(ctx, "Local capture");

    const added = await api(app, "POST", `/topics/${topic.id}/hosts`, {
      body: { host: "https://Example.org/path" },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().hosts.map((h: { host: string }) => h.host)).toContain("example.org");

    const listed = await api(app, "GET", `/topics/${topic.id}/hosts`);
    expect(listed.json().hosts.length).toBeGreaterThan(0);

    const listedTopics = await api(app, "GET", "/topics");
    const topicRows = listedTopics.json().topics as Array<{ id: string; hosts: Array<{ host: string }> }>;
    const row = topicRows.find((t) => t.id === topic.id);
    expect(row?.hosts.map((h) => h.host)).toContain("example.org");

    const aggregate = await api(app, "GET", "/hosts");
    expect(aggregate.json().hosts).toContain("example.org");

    const removed = await api(app, "DELETE", `/topics/${topic.id}/hosts/${encodeURIComponent("example.org")}`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().hosts.map((h: { host: string }) => h.host)).not.toContain("example.org");
  });
});

describe("queue_api", () => {
  it("returns filed items newest-first, hides rejected unless asked, and caps at 100", async () => {
    const { app, ctx } = makeApp();
    const { topic } = seedReady(ctx);

    const titles = ["oldest filed", "middle rejected", "newest filed"];
    const states = ["filed", "rejected", "filed"] as const;
    for (let i = 0; i < titles.length; i++) {
      const itemId = newId();
      ctx.db
        .prepare(
          `INSERT INTO items(id, url, url_normalized, title, captured_at, source, readable_text)
           VALUES (?, ?, ?, ?, ?, 'manual', ?)`,
        )
        .run(
          itemId,
          `https://example.com/${i}`,
          `https://example.com/${i}`,
          titles[i],
          `2026-01-0${i + 1}T00:00:00.000Z`,
          "x".repeat(250),
        );
      ctx.db
        .prepare(`INSERT INTO filings(id, item_id, topic_id, state) VALUES (?, ?, ?, ?)`)
        .run(newId(), itemId, topic.id, states[i]);
    }

    const listed = await api(app, "GET", `/topics/${topic.id}/queue`);
    expect(listed.statusCode).toBe(200);
    const filings = listed.json().filings as Array<{ item_title: string; state: string }>;
    expect(filings.map((f) => f.item_title)).toEqual(["newest filed", "oldest filed"]);
    expect(filings.map((f) => f.state)).toEqual(["filed", "filed"]);

    const withRejected = await api(app, "GET", `/topics/${topic.id}/queue?include_rejected=1`);
    expect(withRejected.json().filings.map((f: { item_title: string }) => f.item_title)).toEqual([
      "newest filed",
      "middle rejected",
      "oldest filed",
    ]);

    const rejectedOnly = await api(app, "GET", `/topics/${topic.id}/queue?states=rejected`);
    expect(rejectedOnly.json().filings.map((f: { item_title: string }) => f.item_title)).toEqual([
      "middle rejected",
    ]);

    for (let i = 0; i < QUEUE_LIMIT + 5; i++) {
      const itemId = newId();
      ctx.db
        .prepare(
          `INSERT INTO items(id, url, url_normalized, title, captured_at, source, readable_text)
           VALUES (?, ?, ?, ?, ?, 'manual', 'body')`,
        )
        .run(
          itemId,
          `https://example.com/extra/${i}`,
          `https://example.com/extra/${i}`,
          `extra ${i}`,
          new Date(Date.UTC(2026, 1, 1, 0, 0, i)).toISOString(),
        );
      ctx.db
        .prepare(`INSERT INTO filings(id, item_id, topic_id, state) VALUES (?, ?, ?, 'filed')`)
        .run(newId(), itemId, topic.id);
    }
    const capped = await api(app, "GET", `/topics/${topic.id}/queue`);
    const cappedFilings = capped.json().filings as Array<{ item_title: string; captured_at: string }>;
    expect(cappedFilings).toHaveLength(QUEUE_LIMIT);
    expect(cappedFilings[0]!.item_title).toBe(`extra ${QUEUE_LIMIT + 4}`);
    for (let i = 1; i < cappedFilings.length; i++) {
      expect(cappedFilings[i - 1]!.captured_at >= cappedFilings[i]!.captured_at).toBe(true);
    }
  });

  it("rejects a filing and hides it from the default list", async () => {
    const { app, ctx } = makeApp();
    const { topic } = seedReady(ctx);
    ingestCapture(ctx, {
      url: "https://example.com/keep-me",
      title: "Manifest V3 capture",
      source: "watching",
      readable_text: "implementation note on Manifest V3 capture ".repeat(12),
    });
    const filing = ctx.db.prepare("SELECT id FROM filings").get() as { id: string };
    const res = await api(app, "POST", `/filings/${filing.id}/verdict`, { body: { action: "reject" } });
    expect(res.statusCode).toBe(200);
    const listed = await api(app, "GET", `/topics/${topic.id}/queue`);
    expect(listed.json().filings).toHaveLength(0);
    expect(() => applyVerdict(ctx, filing.id, "keep")).toThrow(/invalid_action/);
  });
});

describe("delete_topic", () => {
  it("removes the topic and orphans; keeps shared items", async () => {
    const { app, ctx } = makeApp();
    const { topic } = seedReady(ctx);
    const other = createTopic(ctx, "Other");
    putPolicy(ctx, other.topic.id, ["Manifest V3"], []);
    ingestCapture(ctx, {
      url: "https://example.com/only-here",
      title: "Only here Manifest V3",
      source: "manual",
      topic_ids: [topic.id],
      readable_text: "Manifest V3 capture ".repeat(20),
    });
    ingestCapture(ctx, {
      url: "https://example.com/shared",
      title: "Shared Manifest V3",
      source: "manual",
      topic_ids: [topic.id, other.topic.id],
      readable_text: "Manifest V3 capture ".repeat(20),
    });
    const missing = await api(app, "DELETE", "/topics/does-not-exist");
    expect(missing.statusCode).toBe(404);
    const res = await api(app, "DELETE", `/topics/${topic.id}`);
    expect(res.statusCode).toBe(204);
    expect(ctx.db.prepare("SELECT * FROM topics WHERE id = ?").get(topic.id)).toBeUndefined();
    expect(ctx.db.prepare("SELECT title FROM items").all()).toEqual([{ title: "Shared Manifest V3" }]);
    expect(getTopic(ctx.db, other.topic.id)?.title).toBe("Other");
  });
});

describe("assist", () => {
  it("does not write and forces a gap when the draft cites unknown ids", async () => {
    const llm = mockLlm({
      chat: () => ({
        content: JSON.stringify({
          mode: "grounded",
          what_i_know: ["a"],
          talking_points: ["b"],
          draft: "a comment",
          cite: { item_id: "not-retrieved", url: "https://fake.example", quote: "nope" },
          gap: null,
          item_ids: ["not-retrieved"],
        }),
      }),
    });
    const { app, ctx } = makeApp(makeCtx(llm));
    const { topic } = seedReady(ctx);

    for (const [url, title] of [
      ["https://example.com/one", "One Manifest V3"],
      ["https://example.com/two", "Two Manifest V3"],
    ] as const) {
      ingestCapture(ctx, {
        url,
        title,
        source: "manual",
        topic_ids: [topic.id],
        readable_text: "Manifest V3 capture and localhost bridge security notes. ".repeat(8),
      });
    }
    expect(countItems(ctx.db)).toBe(2);

    const before = countItems(ctx.db);
    const assist = await api(app, "POST", "/assist", {
      body: {
        url: "https://news.ycombinator.com/item?id=1",
        title: "Ask HN",
        thread_text: "How do you do local MV3 capture?",
        venue: "hn",
        topic_id: topic.id,
      },
    });
    expect(assist.statusCode).toBe(200);
    expect(countItems(ctx.db)).toBe(before);
    expect(assist.json().mode).toBe("gap");

    const pinGone = await api(app, "POST", "/assist/pin", { body: { topic_id: topic.id } });
    expect(pinGone.statusCode).toBe(404);
  });
});

function seedReady(
  ctx: ReturnType<typeof makeCtx>,
  opts: { include?: string[]; exclude?: string[] } = {},
) {
  const { topic } = createTopic(ctx, "Local capture");
  putPolicy(ctx, topic.id, opts.include ?? ["Manifest V3 capture", "localhost bridge"], opts.exclude ?? []);
  addTopicHost(ctx, topic.id, "example.com");
  return { topic };
}
