import { describe, expect, it } from "vitest";
import { keywordHits, matchesPolicy, normalizeTerms } from "../src/policy.js";

describe("normalizeTerms", () => {
  it("trims, drops blanks, and de-dupes case-insensitively", () => {
    expect(normalizeTerms(["  MV3  ", "", "mv3", "localhost bridge", "localhost bridge"])).toEqual([
      "MV3",
      "localhost bridge",
    ]);
  });

  it("accepts a single string", () => {
    expect(normalizeTerms("  quantum  ")).toEqual(["quantum"]);
  });
});

describe("matchesPolicy", () => {
  it("matches nothing when include is empty", () => {
    expect(matchesPolicy("MV3 capture", "notes", [], [])).toBe(false);
  });

  it("keeps a page that hits an include term", () => {
    expect(matchesPolicy("MV3 capture", "notes on Manifest V3 capture", ["Manifest V3 capture"], [])).toBe(true);
  });

  it("drops a page that hits an exclude term", () => {
    expect(
      matchesPolicy("MV3 capture", "notes on Manifest V3 capture and Microsoft Recall", ["Manifest V3"], ["Recall"]),
    ).toBe(false);
  });

  it("counts a keyword hit on a token inside an include phrase", () => {
    expect(keywordHits("Enhancing LLMs in Predictive Political QA", ["LLM news"])).toBeGreaterThan(0);
  });
});
