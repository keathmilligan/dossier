import { describe, expect, it } from "vitest";
import { normalizePrompt } from "../src/policy.js";

describe("normalizePrompt", () => {
  it("trims and treats non-strings as empty", () => {
    expect(normalizePrompt("  notes on MV3  ")).toBe("notes on MV3");
    expect(normalizePrompt("")).toBe("");
    expect(normalizePrompt("   ")).toBe("");
    expect(normalizePrompt(["MV3"])).toBe("");
    expect(normalizePrompt(undefined)).toBe("");
  });
});
