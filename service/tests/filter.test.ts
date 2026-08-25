import { describe, expect, it } from "vitest";
import { cheapFilter } from "../src/filter.js";

const include = [1, 0, 0];
const exclude = [0, 1, 0];

describe("filter", () => {
  it("keeps high include cosine with margin over exclude", () => {
    const r = cheapFilter({
      title: "MV3 capture",
      host: "example.com",
      text: "notes on Manifest V3 capture",
      pageEmbed: [1, 0, 0],
      includeEmbeds: [include],
      excludeEmbeds: [exclude],
      includeTerms: ["Manifest V3 capture"],
      includeMinCosine: 0.32,
      excludeMargin: 0.04,
    });
    expect(r.include_score).toBeGreaterThan(0.99);
    expect(r.keyword_bonus).toBeGreaterThan(0);
    expect(r.keep).toBe(true);
  });

  it("drops when include cosine is below the threshold", () => {
    const r = cheapFilter({
      title: "Recall explainer",
      host: "example.com",
      text: "microsoft recall",
      pageEmbed: [0, 1, 0],
      includeEmbeds: [include],
      excludeEmbeds: [exclude],
      includeTerms: ["Manifest V3"],
      includeMinCosine: 0.32,
      excludeMargin: 0.04,
    });
    expect(r.keep).toBe(false);
  });

  it("keeps an on-topic page even when exclude cosine is close", () => {
    const r = cheapFilter({
      title: "Enhancing LLMs in Predictive Political QA",
      host: "arxiv.org",
      text: "large language model privacy",
      pageEmbed: [0.7, 0.65, 0],
      includeEmbeds: [[1, 0, 0]],
      excludeEmbeds: [[0, 1, 0]],
      includeTerms: ["LLM news"],
      includeMinCosine: 0.32,
      excludeMargin: 0.04,
    });
    expect(r.include_score).toBeGreaterThan(0.32);
    expect(r.keep).toBe(true);
  });

  it("counts a keyword hit on a token inside an include phrase", () => {
    const r = cheapFilter({
      title: "Enhancing LLMs in Predictive Political QA",
      host: "arxiv.org",
      text: "large language models",
      pageEmbed: [0, 0, 1],
      includeEmbeds: [include],
      excludeEmbeds: [],
      includeTerms: ["LLM news"],
      includeMinCosine: 0.32,
      excludeMargin: 0.04,
    });
    expect(r.keyword_bonus).toBeGreaterThan(0);
  });
});
