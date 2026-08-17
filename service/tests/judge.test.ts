import { describe, expect, it } from "vitest";
import { mapJudgeToFiling, parseJudgeJson } from "../src/judge.js";
import type { NodeRow } from "../src/models.js";

const nodes: NodeRow[] = [
  { id: "n-inbox", topic_id: "t", parent_id: null, kind: "inbox", title: "Inbox", slug: "inbox", position: 0 },
  { id: "n-cap", topic_id: "t", parent_id: null, kind: "section", title: "Capture", slug: "capture-models", position: 1 },
];

describe("judge_map", () => {
  it("maps fixture JSON to filing states", () => {
    expect(mapJudgeToFiling({ include: false, rationale: "off" }, nodes, 0.85, "n-inbox")).toMatchObject({
      state: "rejected",
    });
    expect(
      mapJudgeToFiling({ include: true, node_slug: null, score: 0.9 }, nodes, 0.85, "n-inbox"),
    ).toMatchObject({ state: "inbox", node_id: "n-inbox" });
    expect(
      mapJudgeToFiling(
        { include: true, node_slug: "unknown", score: 0.99 },
        nodes,
        0.85,
        "n-inbox",
      ),
    ).toMatchObject({ state: "inbox" });
    expect(
      mapJudgeToFiling(
        { include: true, node_slug: "capture-models", score: 0.9 },
        nodes,
        0.85,
        "n-inbox",
      ),
    ).toMatchObject({ state: "proposed", node_id: "n-cap" });
    expect(
      mapJudgeToFiling(
        { include: true, node_slug: "capture-models", score: 0.4 },
        nodes,
        0.85,
        "n-inbox",
      ),
    ).toMatchObject({ state: "inbox", node_id: "n-cap" });
    expect(mapJudgeToFiling(parseJudgeJson("not-json"), nodes, 0.85, "n-inbox")).toMatchObject({
      state: "inbox",
    });
  });
});
