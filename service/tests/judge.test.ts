import { describe, expect, it } from "vitest";
import { judgeFiling, parseScope, tickJudge } from "../src/judge.js";
import { ingestCapture } from "../src/capture.js";
import { addTopicHost, createTopic, putPolicy } from "../src/topics.js";
import { makeCtx, mockLlm } from "./harness.js";

describe("parseScope", () => {
  it("reads in_scope, aliases, fences, and surrounding text", () => {
    expect(parseScope('{"in_scope": true}')).toBe(true);
    expect(parseScope('```json\n{"in_scope": false}\n```')).toBe(false);
    expect(parseScope('Sure.\n{"include": true}\n')).toBe(true);
    expect(parseScope('{"in_scope": "yes"}')).toBe(true);
    expect(parseScope("false")).toBe(false);
    expect(parseScope("not-json")).toBeNull();
  });
});

describe("judgeFiling", () => {
  it("files when the model accepts and rejects when it does not", async () => {
    const ctx = makeCtx(
      mockLlm({
        chat: (req) => {
          const user = req.messages.map((m) => m.content).join("\n");
          return { content: JSON.stringify({ in_scope: /MV3 notes/i.test(user) }) };
        },
      }),
    );
    const { topic } = seed(ctx);

    ingestCapture(ctx, {
      url: "https://example.com/keep",
      title: "MV3 notes",
      source: "watching",
      readable_text: "implementation notes on Manifest V3 capture ".repeat(10),
    });
    ingestCapture(ctx, {
      url: "https://example.com/drop",
      title: "cooking",
      source: "watching",
      readable_text: "totally unrelated page body about cooking ".repeat(10),
    });

    await tickJudge(ctx);
    const states = ctx.db
      .prepare("SELECT i.title, f.state FROM filings f JOIN items i ON i.id = f.item_id ORDER BY i.title")
      .all() as Array<{ title: string; state: string }>;
    expect(states).toEqual([
      { title: "MV3 notes", state: "filed" },
      { title: "cooking", state: "rejected" },
    ]);
    expect(topic.title).toBe("Local capture");
  });

  it("asks for JSON and does not send tools", async () => {
    let seen: { json?: boolean; tools?: unknown } | undefined;
    const ctx = makeCtx(
      mockLlm({
        chat: (req) => {
          seen = { json: req.json, tools: req.tools };
          return { content: JSON.stringify({ in_scope: true }) };
        },
      }),
    );
    seed(ctx);
    ingestCapture(ctx, {
      url: "https://example.com/keep",
      title: "MV3 notes",
      source: "watching",
      readable_text: "implementation notes on Manifest V3 capture ".repeat(10),
    });
    await tickJudge(ctx);
    expect(seen).toEqual({ json: true, tools: undefined });
    expect((ctx.db.prepare("SELECT state FROM filings").get() as { state: string }).state).toBe("filed");
  });

  it("leaves the filing queued when the model fails", async () => {
    const ctx = makeCtx(mockLlm({ chat: () => ({ content: "not-json" }) }));
    seed(ctx);
    ingestCapture(ctx, {
      url: "https://example.com/wait",
      title: "MV3 notes",
      source: "watching",
      readable_text: "implementation notes on Manifest V3 capture ".repeat(10),
    });
    const filing = ctx.db.prepare("SELECT * FROM filings").get() as { id: string; state: string };
    expect(filing.state).toBe("queued");
    expect(await judgeFiling(ctx, filing)).toBe(false);
    expect((ctx.db.prepare("SELECT state FROM filings").get() as { state: string }).state).toBe("queued");
  });
});

function seed(ctx: ReturnType<typeof makeCtx>) {
  const { topic } = createTopic(ctx, "Local capture");
  putPolicy(ctx, topic.id, "Pages about Manifest V3 capture and localhost bridges.");
  addTopicHost(ctx, topic.id, "example.com");
  return { topic };
}
