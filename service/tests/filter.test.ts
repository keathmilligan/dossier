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

  it("drops when exclude is closer", () => {
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
});
