import type { FilingState, JudgeResult, NodeRow } from "./models.js";

export interface JudgeMapping {
  state: FilingState;
  node_id: string | null;
  score: number | null;
  rationale: string | null;
  rank_in_node: number | null;
}

export function parseJudgeJson(raw: string): JudgeResult | null {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    const v = JSON.parse(trimmed) as JudgeResult;
    if (typeof v.include !== "boolean") return null;
    return v;
  } catch {
    return null;
  }
}

export function mapJudgeToFiling(
  result: JudgeResult | null,
  nodes: NodeRow[],
  autoAccept: number,
  inboxId: string,
): JudgeMapping {
  if (!result) {
    return {
      state: "inbox",
      node_id: inboxId,
      score: null,
      rationale: null,
      rank_in_node: null,
    };
  }
  const rationale = result.rationale ?? null;
  if (!result.include) {
    return {
      state: "rejected",
      node_id: inboxId,
      score: result.score ?? null,
      rationale,
      rank_in_node: result.score ?? null,
    };
  }
  const slug = result.node_slug ?? null;
  const node = slug ? nodes.find((n) => n.slug === slug && n.kind === "section") : undefined;
  const score = typeof result.score === "number" ? result.score : null;
  if (node && score !== null && score >= autoAccept) {
    return {
      state: "proposed",
      node_id: node.id,
      score,
      rationale,
      rank_in_node: score,
    };
  }
  return {
    state: "inbox",
    node_id: node?.id ?? inboxId,
    score,
    rationale,
    rank_in_node: score,
  };
}
