import { describe, expect, it } from "vitest";
import { hostPermissionOrigins, hostWatchedBy, normalizeHost } from "../src/sites";

describe("normalizeHost", () => {
  it("accepts a bare hostname and strips www / scheme / path", () => {
    expect(normalizeHost("github.com")).toBe("github.com");
    expect(normalizeHost("www.github.com")).toBe("github.com");
    expect(normalizeHost("https://www.github.com/foo")).toBe("github.com");
    expect(normalizeHost("*.arxiv.org")).toBe("arxiv.org");
  });

  it("rejects empty or single-label names", () => {
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("localhost")).toBeNull();
    expect(normalizeHost("not a host")).toBeNull();
  });
});

describe("hostPermissionOrigins", () => {
  it("covers the host and its subdomains", () => {
    expect(hostPermissionOrigins("github.com")).toEqual([
      "https://github.com/*",
      "http://github.com/*",
      "https://*.github.com/*",
      "http://*.github.com/*",
    ]);
  });
});

describe("hostWatchedBy", () => {
  it("matches the host or a subdomain", () => {
    expect(hostWatchedBy("github.com", ["github.com"])).toBe(true);
    expect(hostWatchedBy("gist.github.com", ["github.com"])).toBe(true);
    expect(hostWatchedBy("example.com", ["github.com"])).toBe(false);
  });
});
