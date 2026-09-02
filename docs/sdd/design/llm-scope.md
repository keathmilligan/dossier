---
id: llm-scope
---

# Design: Judge pages with a policy prompt

## Approach

Store a single prompt per topic. Ingest every watched page as a `queued` filing. A small tick asks the LLM whether that page is in scope and sets `filed` or `rejected`. The filing row is the work queue — do not bring back a jobs table.

## Schema

Bump `SCHEMA_VERSION` to `3`. Mismatch still replaces the file.

- `policies` — `id`, `topic_id` unique, `prompt` TEXT default `''`, `updated_at`
- `filings.state` — `queued` | `filed` | `rejected`

## Judge

One chat call, JSON only: `{ "in_scope": true | false }`. System prompt: apply the topic prompt to the page title and body; do not summarize. Unparseable output or LLM error leaves the row `queued` for the next tick.

Tick from `index.ts` (a few seconds). Claim `queued` rows one at a time so a slow model does not pile up parallel calls. Ingest can kick the tick but must not await it.

## Eligibility

Queue when (1) host is on the topic's site list, (2) prompt is non-empty after trim. Empty prompt → drop (no item unless another topic queued it). Re-ingest of an existing `(item, topic)` does not reset state.

## Assist

`pickTopic` scores the thread against topic title + prompt with the same token-overlap helper retrieve already needs. Move that helper out of `policy.ts`. Do not score include lists.

## Risks

- A down or slow LLM leaves a growing queued list. That is the stated behavior.
- Page text goes to the configured `base_url` on every watched page, not only assist.
