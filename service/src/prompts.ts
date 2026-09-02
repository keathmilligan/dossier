export const PROMPT_SCOPE = `Decide if a page belongs in the topic described by PROMPT.
Treat the title as strong evidence. Related subtopics count as in scope.
If the page is plausibly about the topic, in_scope is true.
in_scope is false only when the page is clearly unrelated.
Reply with JSON only: {"in_scope": true} or {"in_scope": false}. Do not explain.`;

export const PROMPT_ASSIST = `You draft a short, grounded remark from the user's current (possibly thin) dossier.
Return JSON only. No markdown fences.
Schema:
{
  "mode": "grounded" | "gap",
  "what_i_know": string[],
  "talking_points": string[],
  "draft": string | null,
  "cite": {"item_id": string, "url": string, "quote": string} | null,
  "gap": string | null,
  "item_ids": string[]
}
Rules:
- Every factual clause in draft must be supportable by a retrieved extract below. If not, omit it.
- Prefer precise and short.
- Venue hn: at most one link. Venue github: complete sentences.
- Never claim consensus. Never invent sources.
- item_ids must be a subset of the retrieved item ids.
- If you cannot ground a draft, return mode=gap even if items were retrieved.
- Do not invent URLs or quotes.`;
