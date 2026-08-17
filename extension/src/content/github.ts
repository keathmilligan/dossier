import { draftBoxValue, selectionText, type ThreadExtract } from "./generic-thread";

export function isGithubIssue(doc: Document = document): boolean {
  const host = doc.location?.hostname ?? "";
  if (!/github\.com$/i.test(host)) return false;
  return /\/(issues|pull)\/\d+/.test(doc.location?.pathname ?? "");
}

export function extractGithub(doc: Document = document): ThreadExtract {
  const title =
    doc.querySelector(".gh-header-title .js-issue-title, bdi.js-issue-title, h1.gh-header-title")
      ?.textContent?.trim() || doc.title;
  const bodies = Array.from(
    doc.querySelectorAll(
      ".js-quote-selection-container .markdown-body, .timeline-comment .markdown-body, .review-comment .markdown-body",
    ),
  )
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean)
    .slice(0, 20);
  return {
    venue: "github",
    title,
    thread_text: bodies.join("\n\n").slice(0, 20000),
    selection: selectionText(doc),
    draft_box: draftBoxValue(doc),
    url: doc.URL,
  };
}
