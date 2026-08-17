import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractReadable } from "../src/readability";
import { extractHn } from "../src/content/hn";
import { extractGithub } from "../src/content/github";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function load(name: string, url: string): Document {
  const html = readFileSync(join(dir, name), "utf8");
  return new JSDOM(html, { url }).window.document;
}

describe("readability", () => {
  it("extracts article text and ignores password fields", () => {
    const doc = load("article.html", "https://example.com/mv3");
    const r = extractReadable(doc, "https://example.com/mv3");
    expect(r.title).toMatch(/MV3/i);
    expect(r.readable_text).toContain("Service workers die");
    expect(r.readable_text).not.toContain("secret");
  });
});

describe("hn parser", () => {
  it("includes story title and comment chain", () => {
    const doc = load("hn.html", "https://news.ycombinator.com/item?id=1#101");
    const r = extractHn(doc);
    expect(r.venue).toBe("hn");
    expect(r.title).toContain("local capture");
    expect(r.thread_text).toContain("alice");
    expect(r.thread_text).toContain("too much mail");
  });
});

describe("github parser", () => {
  it("takes issue title and timeline comments, not the repo README", () => {
    const doc = load("github.html", "https://github.com/acme/dossier/issues/12");
    const r = extractGithub(doc);
    expect(r.venue).toBe("github");
    expect(r.title).toContain("Accept policy");
    expect(r.thread_text).toContain("Watching should not start");
    expect(r.thread_text).not.toContain("repo README");
  });
});
