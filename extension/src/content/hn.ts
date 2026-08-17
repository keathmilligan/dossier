import { draftBoxValue, selectionText, type ThreadExtract } from "./generic-thread";

export function isHn(doc: Document = document): boolean {
  return /news\.ycombinator\.com$/i.test(doc.location?.hostname ?? "");
}

export function extractHn(doc: Document = document): ThreadExtract {
  const title =
    doc.querySelector(".fatitem .titleline a")?.textContent?.trim() ||
    doc.querySelector(".titleline a")?.textContent?.trim() ||
    doc.title;
  const comments: string[] = [];
  const selected = findCurrentComment(doc);
  if (selected) {
    for (const row of ancestorChain(selected)) {
      const text = commentText(row);
      if (text) comments.push(text);
    }
  } else {
    const story = doc.querySelector(".fatitem .toptext, .fatitem .commtext");
    if (story?.textContent) comments.push(story.textContent.trim());
    for (const row of Array.from(doc.querySelectorAll("tr.comtr")).slice(0, 12)) {
      const text = commentText(row);
      if (text) comments.push(text);
    }
  }
  return {
    venue: "hn",
    title,
    thread_text: comments.join("\n\n").slice(0, 20000),
    selection: selectionText(doc),
    draft_box: draftBoxValue(doc),
    url: doc.URL,
  };
}

function commentText(row: Element): string {
  const user = row.querySelector(".hnuser")?.textContent?.trim() ?? "";
  const body = row.querySelector(".commtext")?.textContent?.trim() ?? "";
  if (!body) return "";
  return user ? `${user}: ${body}` : body;
}

function findCurrentComment(doc: Document): Element | null {
  const hash = doc.location?.hash?.replace(/^#/, "");
  if (hash) {
    const byId = doc.getElementById(hash) ?? doc.querySelector(`#up_${hash}`);
    const row = byId?.closest("tr.comtr");
    if (row) return row;
  }
  const sel = doc.getSelection()?.anchorNode;
  if (sel) {
    const el = sel instanceof Element ? sel : sel.parentElement;
    const row = el?.closest("tr.comtr");
    if (row) return row;
  }
  return null;
}

function ancestorChain(row: Element): Element[] {
  const all = Array.from(row.ownerDocument.querySelectorAll("tr.comtr"));
  const idx = all.indexOf(row as HTMLTableRowElement);
  if (idx < 0) return [row];
  const chain = [row];
  let indent = indentOf(row);
  for (let i = idx - 1; i >= 0; i--) {
    const prev = all[i]!;
    const p = indentOf(prev);
    if (p < indent) {
      chain.unshift(prev);
      indent = p;
    }
  }
  return chain;
}

function indentOf(row: Element): number {
  const cell = row.querySelector(".ind");
  const attr = cell?.getAttribute("indent");
  if (attr !== null && attr !== undefined && attr !== "") {
    const n = Number(attr);
    if (Number.isFinite(n)) return n;
  }
  const img =
    (row.querySelector(".ind img") as HTMLImageElement | null) ??
    (row.querySelector("img.ind") as HTMLImageElement | null);
  const w = img ? Number(img.getAttribute("width") ?? img.width ?? 0) : 0;
  return Number.isFinite(w) ? w : 0;
}
