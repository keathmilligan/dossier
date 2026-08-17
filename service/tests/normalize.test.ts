import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/normalize.js";

describe("normalize", () => {
  it("strips token-like query params", () => {
    expect(normalizeUrl("https://example.com/a?token=abc&q=1")).toBe(
      "https://example.com/a?q=1",
    );
    expect(normalizeUrl("https://example.com/a?session=x&sig=y&signature=z")).toBe(
      "https://example.com/a",
    );
    expect(normalizeUrl("https://example.com/a?auth=1&code=2&access_key=3")).toBe(
      "https://example.com/a",
    );
    expect(normalizeUrl("https://example.com/a?password=p&passwd=q&keep=1")).toBe(
      "https://example.com/a?keep=1",
    );
  });

  it("collapses http/https, default ports, fragments, trailing slash", () => {
    expect(normalizeUrl("http://Example.COM:80/path/#frag")).toBe("https://example.com/path");
    expect(normalizeUrl("https://example.com:443/path/")).toBe("https://example.com/path");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });
});
