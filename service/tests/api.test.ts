import { describe, expect, it } from "vitest";
import { api, authHeaders, drain, makeApp, makeCtx, mockLlm, SAMPLE_POLICY, TOKEN } from "./harness.js";
import { createTopic } from "../src/topics.js";
import { createProposal } from "../src/chat.js";
import {
  acceptPolicy,
  addTopicHost,
  applyStructure,
  applyVerdict,
  removeTopicHost,
} from "../src/topics.js";
import { ingestCapture } from "../src/capture.js";
import { countItems, enqueueJob, getTopic, inboxNode, listNodes, listTopicHosts } from "../src/store.js";
import { encodeVec, hashEmbed } from "../src/embeddings.js";
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
    await seedTopic(ctx);
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

describe("manual_keeps / watching_drops", () => {
  it("keeps manual items below filter threshold and drops watching ones", async () => {
    const includeVec = [1, 0, 0, 0];
    const pageVec = [0, 1, 0, 0];
    const llm = mockLlm({
      embed: (text) =>
        /manifest v3|localhost bridge/i.test(text) ? includeVec : pageVec,
      chat: () => ({
        content: JSON.stringify({
          include: true,
          node_slug: null,
          score: 0.3,
          rationale: "weak",
          extracts: [],
        }),
      }),
    });
    const ctx = makeCtx(llm);
    const { topic } = await seedAccepted(ctx);
    addTopicHost(ctx, topic.id, "example.com");

    ingestCapture(ctx, {
      url: "https://example.com/manual-page",
      title: "cooking",
      source: "manual",
      topic_ids: [topic.id],
      readable_text: "totally unrelated page body about cooking ".repeat(10),
    });
    await drain(ctx);
    expect(countItems(ctx.db)).toBe(1);
    const manualFiling = ctx.db.prepare("SELECT * FROM filings").get() as { state: string };
    expect(manualFiling).toBeTruthy();

    ctx.db.prepare("DELETE FROM filings").run();
    ctx.db.prepare("DELETE FROM items").run();
    ctx.db.prepare("DELETE FROM items_fts").run();
    ctx.db.prepare("DELETE FROM jobs").run();

    ingestCapture(ctx, {
      url: "https://example.com/watch-page",
      title: "cooking",
      source: "watching",
      readable_text: "totally unrelated page body about cooking ".repeat(10),
    });
    await drain(ctx);
    expect(countItems(ctx.db)).toBe(1);
    const watchFiling = ctx.db.prepare("SELECT * FROM filings").get() as { state: string; rationale: string };
    expect(watchFiling.state).toBe("rejected");
    expect(watchFiling.rationale).toBe("filtered");
  });
});

describe("topic_hosts", () => {
  it("seeds sites from the first accepted policy, requires a policy to add, and lets you add/remove independently of later re-accepts", async () => {
    const ctx = makeCtx();
    const { topic } = createTopic(ctx, "Local capture");

    expect(() => addTopicHost(ctx, topic.id, "example.com")).toThrow(/policy/);

    const proposal = createProposal(ctx, topic.id, null, SAMPLE_POLICY);
    await acceptPolicy(ctx, topic.id, proposal.id);
    const seeded = listTopicHosts(ctx.db, topic.id).map((h) => h.host);
    expect(seeded).toEqual(expect.arrayContaining(["example.com", "news.ycombinator.com", "github.com"]));

    const afterAdd = addTopicHost(ctx, topic.id, "https://www.arxiv.org/list");
    expect(afterAdd.map((h) => h.host)).toContain("arxiv.org");

    const afterRemove = removeTopicHost(ctx, topic.id, "example.com");
    expect(afterRemove.map((h) => h.host)).not.toContain("example.com");

    // Re-accepting a newer policy version must not silently re-add or change hosts.
    const p2 = createProposal(ctx, topic.id, null, SAMPLE_POLICY.replace("local capture", "v2"));
    await acceptPolicy(ctx, topic.id, p2.id);
    const afterReaccept = listTopicHosts(ctx.db, topic.id).map((h) => h.host);
    expect(afterReaccept).not.toContain("example.com");
    expect(afterReaccept).toContain("arxiv.org");
  });
});

describe("accept_policy", () => {
  it("does not run until accept; version bumps; embeds refresh", async () => {
    const ctx = makeCtx();
    const { topic } = createTopic(ctx, "Local capture");
    const proposal = createProposal(ctx, topic.id, null, SAMPLE_POLICY);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM policies").get() as { n: number }).toEqual({
      n: 0,
    });
    const first = await acceptPolicy(ctx, topic.id, proposal.id);
    expect(first.version).toBe(1);
    const embeds = ctx.db.prepare("SELECT COUNT(*) AS n FROM embeddings").get() as { n: number };
    expect(embeds.n).toBeGreaterThan(0);
    const p2 = createProposal(ctx, topic.id, null, SAMPLE_POLICY.replace("local capture", "v2"));
    const second = await acceptPolicy(ctx, topic.id, p2.id);
    expect(second.version).toBe(2);
  });
});

describe("hosts_api", () => {
  it("rejects adding a site before a policy is accepted, then adds/lists/removes over HTTP", async () => {
    const { app, ctx } = makeApp();
    const { topic } = createTopic(ctx, "Local capture");

    const denied = await api(app, "POST", `/topics/${topic.id}/hosts`, { body: { host: "example.com" } });
    expect(denied.statusCode).toBe(400);
    expect(denied.json().error).toBe("no_policy");

    const proposal = createProposal(ctx, topic.id, null, SAMPLE_POLICY);
    await acceptPolicy(ctx, topic.id, proposal.id);

    const added = await api(app, "POST", `/topics/${topic.id}/hosts`, {
      body: { host: "https://Example.org/path" },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().hosts.map((h: { host: string }) => h.host)).toContain("example.org");

    const listed = await api(app, "GET", `/topics/${topic.id}/hosts`);
    expect(listed.json().hosts.length).toBeGreaterThan(0);

    const aggregate = await api(app, "GET", "/hosts");
    expect(aggregate.json().hosts).toContain("example.org");

    const removed = await api(app, "DELETE", `/topics/${topic.id}/hosts/${encodeURIComponent("example.org")}`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().hosts.map((h: { host: string }) => h.host)).not.toContain("example.org");
  });
});

describe("queue_api", () => {
  it("returns all states newest-first, caps at 100, and marks in-flight jobs", async () => {
    const { app, ctx } = makeApp();
    const { topic } = await seedAccepted(ctx);
    const inbox = inboxNode(ctx.db, topic.id);

    const titles = ["oldest filed", "middle rejected", "newest inbox"];
    const states = ["filed", "rejected", "inbox"] as const;
    const ids: string[] = [];
    for (let i = 0; i < titles.length; i++) {
      const itemId = newId();
      ids.push(itemId);
      ctx.db
        .prepare(
          `INSERT INTO items(id, url, url_normalized, title, captured_at, source, origin, readable_text)
           VALUES (?, ?, ?, ?, ?, 'manual', 'public', ?)`,
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
        .prepare(
          `INSERT INTO filings(id, item_id, topic_id, node_id, state, pinned) VALUES (?, ?, ?, ?, ?, 0)`,
        )
        .run(newId(), itemId, topic.id, inbox.id, states[i]);
    }

    enqueueJob(ctx.db, "embed", { item_id: ids[2], source: "manual", topic_ids: [topic.id] });

    const listed = await api(app, "GET", `/topics/${topic.id}/queue`);
    expect(listed.statusCode).toBe(200);
    const filings = listed.json().filings as Array<{
      item_title: string;
      state: string;
      in_flight: boolean;
      job_kind: string | null;
      job_state: string | null;
    }>;
    expect(filings.map((f) => f.item_title)).toEqual(["newest inbox", "oldest filed"]);
    expect(filings.map((f) => f.state)).toEqual(["queued", "filed"]);
    expect(filings[0]).toMatchObject({ in_flight: true, job_kind: "embed", job_state: "queued" });
    expect(filings[1]!.in_flight).toBe(false);

    const withRejected = await api(app, "GET", `/topics/${topic.id}/queue?include_rejected=1`);
    expect(withRejected.json().filings.map((f: { item_title: string }) => f.item_title)).toEqual([
      "newest inbox",
      "middle rejected",
      "oldest filed",
    ]);

    const goneId = enqueueJob(ctx.db, "embed", {
      item_id: "gone-item",
      source: "watching",
      topic_ids: [topic.id],
      title: "Filtered arXiv page",
      url: "https://arxiv.org/abs/dropped",
    });
    ctx.db.prepare("UPDATE jobs SET state = 'done' WHERE id = ?").run(goneId);
    const hiddenDropped = await api(app, "GET", `/topics/${topic.id}/queue`);
    expect(
      (hiddenDropped.json().filings as Array<{ item_title: string }>).some((f) => f.item_title === "Filtered arXiv page"),
    ).toBe(false);
    const withDropped = await api(app, "GET", `/topics/${topic.id}/queue?include_rejected=1`);
    const dropped = (withDropped.json().filings as Array<{ item_title: string; state: string; url: string }>).find(
      (f) => f.item_title === "Filtered arXiv page",
    );
    expect(dropped).toMatchObject({
      state: "dropped",
      url: "https://arxiv.org/abs/dropped",
    });
    ctx.db.prepare("DELETE FROM jobs WHERE payload LIKE '%gone-item%'").run();

    const rejectedOnly = await api(app, "GET", `/topics/${topic.id}/queue?states=rejected`);
    expect(rejectedOnly.json().filings.map((f: { item_title: string }) => f.item_title)).toEqual([
      "middle rejected",
    ]);

    for (let i = 0; i < QUEUE_LIMIT + 5; i++) {
      const itemId = newId();
      ctx.db
        .prepare(
          `INSERT INTO items(id, url, url_normalized, title, captured_at, source, origin, readable_text)
           VALUES (?, ?, ?, ?, ?, 'manual', 'public', 'body')`,
        )
        .run(
          itemId,
          `https://example.com/extra/${i}`,
          `https://example.com/extra/${i}`,
          `extra ${i}`,
          new Date(Date.UTC(2026, 1, 1, 0, 0, i)).toISOString(),
        );
      ctx.db
        .prepare(
          `INSERT INTO filings(id, item_id, topic_id, node_id, state, pinned) VALUES (?, ?, ?, ?, 'inbox', 0)`,
        )
        .run(newId(), itemId, topic.id, inbox.id);
    }
    const capped = await api(app, "GET", `/topics/${topic.id}/queue`);
    const cappedFilings = capped.json().filings as Array<{ item_title: string; captured_at: string }>;
    expect(cappedFilings).toHaveLength(QUEUE_LIMIT);
    expect(cappedFilings[0]!.item_title).toBe(`extra ${QUEUE_LIMIT + 4}`);
    for (let i = 1; i < cappedFilings.length; i++) {
      expect(cappedFilings[i - 1]!.captured_at >= cappedFilings[i]!.captured_at).toBe(true);
    }
  });
});

describe("delete_topic", () => {
  it("removes the topic, orphans, and policy embeds; keeps shared items", async () => {
    const { app, ctx } = makeApp();
    const { topic } = await seedAccepted(ctx);
    const other = createTopic(ctx, "Other");
    ingestCapture(ctx, {
      url: "https://example.com/only-here",
      title: "Only here",
      source: "manual",
      topic_ids: [topic.id],
      readable_text: "x".repeat(250),
    });
    ingestCapture(ctx, {
      url: "https://example.com/shared",
      title: "Shared",
      source: "manual",
      topic_ids: [topic.id, other.topic.id],
      readable_text: "y".repeat(250),
    });
    const missing = await api(app, "DELETE", "/topics/does-not-exist");
    expect(missing.statusCode).toBe(404);
    const res = await api(app, "DELETE", `/topics/${topic.id}`);
    expect(res.statusCode).toBe(204);
    expect(ctx.db.prepare("SELECT * FROM topics WHERE id = ?").get(topic.id)).toBeUndefined();
    expect(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM embeddings WHERE owner_type LIKE 'policy_%'").get() as {
        n: number;
      },
    ).toEqual({ n: 0 });
    expect(ctx.db.prepare("SELECT title FROM items").all()).toEqual([{ title: "Shared" }]);
    expect(getTopic(ctx.db, other.topic.id)?.title).toBe("Other");
  });
});

describe("structure_orphan", () => {
  it("dumps filings to inbox when a node is deleted", async () => {
    const ctx = makeCtx();
    const { topic } = await seedAccepted(ctx);
    applyStructure(ctx, topic.id, [
      { title: "Capture", slug: "capture", position: 1 },
      { title: "Privacy", slug: "privacy", position: 2 },
    ]);
    const nodes = listNodes(ctx.db, topic.id);
    const cap = nodes.find((n) => n.slug === "capture")!;
    ingestCapture(ctx, {
      url: "https://example.com/a",
      title: "A",
      source: "manual",
      topic_ids: [topic.id],
      readable_text: "x".repeat(250),
    });
    const filing = ctx.db.prepare("SELECT id FROM filings").get() as { id: string };
    applyVerdict(ctx, filing.id, "keep", cap.id);
    applyStructure(ctx, topic.id, [{ title: "Privacy", slug: "privacy", position: 1 }]);
    const after = ctx.db.prepare("SELECT state, node_id FROM filings").get() as {
      state: string;
      node_id: string;
    };
    const inbox = inboxNode(ctx.db, topic.id);
    expect(after.node_id).toBe(inbox.id);
    expect(after.state).toBe("inbox");
  });
});

describe("brief_omits_rejected / export_roundtrip", () => {
  it("omits rejected items and export contains title, section, url", async () => {
    const { app, ctx } = makeApp();
    const { topic } = await seedAccepted(ctx);
    applyStructure(ctx, topic.id, [{ title: "Capture models", slug: "capture-models", position: 1 }]);
    const cap = listNodes(ctx.db, topic.id).find((n) => n.slug === "capture-models")!;
    ingestCapture(ctx, {
      url: "https://example.com/keep-me",
      title: "Keep this",
      source: "manual",
      topic_ids: [topic.id],
      readable_text: "implementation note on MV3 capture ".repeat(20),
    });
    ingestCapture(ctx, {
      url: "https://example.com/drop-me",
      title: "Drop this",
      source: "manual",
      topic_ids: [topic.id],
      readable_text: "noise ".repeat(40),
    });
    const filings = ctx.db.prepare("SELECT id, item_id FROM filings ORDER BY id").all() as Array<{
      id: string;
      item_id: string;
    }>;
    applyVerdict(ctx, filings[0]!.id, "keep", cap.id);
    applyVerdict(ctx, filings[1]!.id, "reject");

    const brief = await api(app, "GET", `/topics/${topic.id}/brief`);
    const md = brief.json().markdown as string;
    expect(md).toContain("Keep this");
    expect(md).not.toContain("Drop this");

    const exp = await api(app, "GET", `/topics/${topic.id}/export.md`);
    expect(exp.statusCode).toBe(200);
    expect(exp.body).toContain("title:");
    expect(exp.body).toContain("Capture models");
    expect(exp.body).toContain("https://example.com/keep-me");
  });
});

describe("assist", () => {
  it("does not write unless pin; pin writes; private items do not leak; ungrounded ids force gap", async () => {
    const llm = mockLlm({
      embed: () => [1, 0, 0, 0],
      chat: (req) => {
        if (req.system.includes("grounded remark")) {
          return {
            content: JSON.stringify({
              mode: "grounded",
              what_i_know: ["a"],
              talking_points: ["b"],
              draft: "a comment",
              cite: { item_id: "not-retrieved", url: "https://fake.example", quote: "nope" },
              gap: null,
              item_ids: ["not-retrieved"],
            }),
          };
        }
        return {
          content: JSON.stringify({
            include: true,
            node_slug: null,
            score: 0.5,
            rationale: "ok",
            extracts: [{ kind: "quote", text: "MV3 capture works locally", attribution: "§1" }],
          }),
        };
      },
    });
    const { app, ctx } = makeApp(makeCtx(llm));
    const { topic } = await seedAccepted(ctx);

    for (const [url, title] of [
      ["https://example.com/one", "One"],
      ["https://example.com/two", "Two"],
    ] as const) {
      ingestCapture(ctx, {
        url,
        title,
        source: "manual",
        topic_ids: [topic.id],
        readable_text: "Manifest V3 capture and localhost bridge security notes. ".repeat(8),
      });
    }
    await drain(ctx);
    const items = ctx.db.prepare("SELECT id FROM items").all() as Array<{ id: string }>;
    expect(items.length).toBe(2);
    for (const it of items) {
      applyVerdict(
        ctx,
        (ctx.db.prepare("SELECT id FROM filings WHERE item_id = ?").get(it.id) as { id: string }).id,
        "keep",
      );
    }

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

    const pin = await api(app, "POST", "/assist/pin", {
      body: {
        url: "https://news.ycombinator.com/item?id=1",
        title: "Ask HN",
        thread_text: "Pin this objection about capture.",
        selection: "Pin this objection about capture.",
        venue: "hn",
        topic_id: topic.id,
      },
    });
    expect(pin.statusCode).toBe(200);
    expect(countItems(ctx.db)).toBe(before + 1);

    const privateItem = newId();
    ctx.db
      .prepare(
        `INSERT INTO items(id, url, url_normalized, title, captured_at, source, origin, readable_text)
         VALUES (?, 'https://mail.google.com/x', 'https://mail.google.com/x', 'Secret mail', datetime('now'), 'pin', 'private', ?)`,
      )
      .run(privateItem, "private mail about capture ".repeat(10));
    const inbox = inboxNode(ctx.db, topic.id);
    ctx.db
      .prepare(
        `INSERT INTO filings(id, item_id, topic_id, node_id, state, pinned) VALUES (?, ?, ?, ?, 'filed', 0)`,
      )
      .run(newId(), privateItem, topic.id, inbox.id);
    ctx.db
      .prepare(
        `INSERT INTO embeddings(id, owner_type, owner_id, model, dim, vec) VALUES (?, 'item', ?, ?, 8, ?)`,
      )
      .run(newId(), privateItem, ctx.config.llm.embed_model, encodeVec(hashEmbed("secret mail")));

    const leak = await api(app, "POST", "/assist", {
      body: {
        url: "https://news.ycombinator.com/item?id=2",
        thread_text: "secret mail about capture",
        venue: "hn",
        topic_id: topic.id,
        include_private: false,
      },
    });
    const ids = (leak.json().item_ids as string[]) ?? [];
    expect(ids).not.toContain(privateItem);
  });
});

async function seedTopic(ctx: ReturnType<typeof makeCtx>) {
  return createTopic(ctx, "Local capture");
}

async function seedAccepted(ctx: ReturnType<typeof makeCtx>) {
  const { topic } = createTopic(ctx, "Local capture");
  const proposal = createProposal(ctx, topic.id, null, SAMPLE_POLICY);
  await acceptPolicy(ctx, topic.id, proposal.id);
  return { topic };
}


