import { Readability } from "@mozilla/readability";

export interface ExtractResult {
  title: string;
  readable_text: string;
  url: string;
  referrer: string;
}

export function extractReadable(doc: Document, url = doc.URL): ExtractResult {
  const clone = doc.cloneNode(true) as Document;
  clone
    .querySelectorAll(
      'input[type="password"], iframe[src*="stripe"], iframe[src*="paypal"], iframe[src*="checkout"]',
    )
    .forEach((el) => el.remove());
  let article: { title?: string | null; textContent?: string | null } | null = null;
  try {
    article = new Readability(clone).parse();
  } catch {
    article = null;
  }
  const text =
    article?.textContent?.trim() ||
    clone.body?.innerText?.trim() ||
    doc.body?.innerText?.trim() ||
    "";
  return {
    title: article?.title?.trim() || doc.title || url,
    readable_text: text,
    url,
    referrer: doc.referrer || "",
  };
}
