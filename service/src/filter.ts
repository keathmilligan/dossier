import { cosine } from "./embeddings.js";

export interface FilterInput {
  title: string;
  host: string;
  text: string;
  pageEmbed: number[] | null;
  includeEmbeds: number[][];
  excludeEmbeds: number[][];
  includeTerms: string[];
  includeMinCosine: number;
  excludeMargin: number;
}

export interface FilterResult {
  keep: boolean;
  score: number;
  include_score: number;
  exclude_score: number;
  keyword_bonus: number;
}

export function keywordHits(haystack: string, terms: string[]): number {
  const h = haystack.toLowerCase();
  let n = 0;
  for (const term of terms) {
    const t = term.trim().toLowerCase();
    if (t.length >= 3 && h.includes(t)) n += 1;
  }
  return n;
}

export function cheapFilter(input: FilterInput): FilterResult {
  const include_score = maxCosine(input.pageEmbed, input.includeEmbeds);
  const exclude_score = maxCosine(input.pageEmbed, input.excludeEmbeds);
  const hay = `${input.title} ${input.host} ${input.text.slice(0, 2000)}`;
  const keyword_bonus = 0.05 * keywordHits(hay, input.includeTerms);
  const score = include_score + keyword_bonus - exclude_score;
  const keep =
    score >= input.includeMinCosine &&
    include_score >= exclude_score + input.excludeMargin;
  return { keep, score, include_score, exclude_score, keyword_bonus };
}

function maxCosine(page: number[] | null, others: number[][]): number {
  if (!page || others.length === 0) return 0;
  let best = 0;
  for (const other of others) {
    const c = cosine(page, other);
    if (c > best) best = c;
  }
  return best;
}
