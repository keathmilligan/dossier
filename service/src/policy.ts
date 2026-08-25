export function normalizeTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return typeof raw === "string" && raw.trim() ? [raw.trim()] : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    const t = typeof x === "string" ? x.trim() : "";
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function keywordHits(haystack: string, terms: string[]): number {
  const h = haystack.toLowerCase();
  let n = 0;
  for (const term of terms) {
    const t = term.trim().toLowerCase();
    if (!t) continue;
    if (t.length >= 3 && h.includes(t)) {
      n += 1;
      continue;
    }
    const words = t.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (words.some((w) => h.includes(w))) n += 1;
  }
  return n;
}

export function matchesPolicy(title: string, body: string, include: string[], exclude: string[]): boolean {
  if (include.length === 0) return false;
  const hay = `${title} ${body}`;
  if (keywordHits(hay, exclude) > 0) return false;
  return keywordHits(hay, include) > 0;
}
