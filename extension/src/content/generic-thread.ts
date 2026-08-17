export interface ThreadExtract {
  venue: "generic" | "hn" | "github";
  title: string;
  thread_text: string;
  selection: string;
  draft_box: string;
  url: string;
}

export function selectionText(doc: Document = document): string {
  return doc.getSelection()?.toString().trim() ?? "";
}

export function draftBoxValue(doc: Document = document): string {
  const el = doc.activeElement;
  if (!el) return "";
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value;
  if (el instanceof HTMLElement && el.isContentEditable) return el.innerText;
  return "";
}

export function extractGeneric(doc: Document = document): ThreadExtract {
  const body = doc.body?.innerText ?? "";
  return {
    venue: "generic",
    title: doc.title,
    thread_text: body.slice(0, 20000),
    selection: selectionText(doc),
    draft_box: draftBoxValue(doc),
    url: doc.URL,
  };
}
