---
id: calibrate-scope-judge
status: accepted
features: [capture]
created: 2026-09-02
updated: 2026-09-02
---

# File pages that are plausibly in scope

| Created | Updated |
| --- | --- |
| 2026-09-02 | 2026-09-02 |

## Why

Every watched page is being rejected, including ones that clearly match the topic. Against a topic prompt `LLMs, agentic AI and related topics`, llama3.2 rejected *Can LLMs Discover Scientific Laws in Real and Parallel Worlds?* and *Learning Autonomous Policies from Imperfect VLM Teachers*.

The judge's system prompt is the cause. It says in-scope is true *only* when the page matches, and **if unsure, false**. With a small local model that instruction is a default-reject. Replaying the stored items: the current prompt returned `false` on those papers; a prompt that files when the page is plausibly about the topic returned `true`, and still returned `false` for an unrelated cooking page.

## What changes

- **File on plausible match.** The scope system prompt treats the page title as strong evidence, counts related subtopics as in scope, and sets `in_scope` false only when the page is clearly unrelated. Drop "if unsure, false".
- **JSON, not tools.** Ask for `{ "in_scope": true | false }` with `response_format: json_object`, matching the llm-scope design. Stop sending a `decide_scope` tool. llama3.2 tool calls are noisy (`"true"` / `"false"` as strings) and not needed once the prompt is calibrated.
- **Unparseable still stays queued.** LLM errors and junk output do not become rejects.

Already queued / filed / rejected rows are not re-judged unless the open question below says otherwise. New pages use the new prompt.

## Scope

- In: `PROMPT_SCOPE`, the judge chat call (JSON instead of tools), tests for the new parse path
- Out: re-extracting page text; embeddings; changing ingest, sites, pause, or assist; changing the user's topic prompt

## Impacted specifications

- `capture` (existing) — when a queued page becomes `filed` vs `rejected`

## Open questions

- Re-judge existing rejects: no. Leave them; recapture if you want them filed.

## Change history

| Date | Change |
| --- | --- |
| 2026-09-02 | Initial proposal |
| 2026-09-02 | Approved; leave existing rejects; implementing |
| 2026-09-02 | Implementation complete; awaiting review |
| 2026-09-02 | Accepted and archived |
