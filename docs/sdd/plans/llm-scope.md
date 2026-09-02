---
id: llm-scope
---

# Plan: Judge pages with a policy prompt

## 1. Schema and models

- [x] 1.1 Bump `SCHEMA_VERSION` to `3`. `policies.prompt` TEXT; drop `include_json` / `exclude_json`. `filings.state` CHECK includes `queued`.
- [x] 1.2 Policy type is `{ prompt }`. `FilingState` is `queued` | `filed` | `rejected`. Default queue list is queued + filed.

## 2. Policy

- [x] 2.1 Replace `policy.ts` with prompt normalize (trim). Delete `normalizeTerms`, `keywordHits`, `matchesPolicy`.
- [x] 2.2 `insertEmptyPolicy` / `savePolicy` / `PUT /topics/:id/policy` take `{ prompt }`. Topic GET returns that. Log `policy_updated` with prompt length, not include/exclude counts.

## 3. Capture and judge

- [x] 3.1 Ingest: if the topic has a non-empty prompt and lists the host, save the item and a `queued` filing. Empty prompt or no site → drop. Do not keyword-match.
- [x] 3.2 Add `judge.ts`: one JSON `{ in_scope }` chat; true → `filed`, false → `rejected`; error/unparseable → leave `queued`.
- [x] 3.3 Tick from `index.ts` processes queued filings one at a time. Kick after ingest; do not await the LLM on `/capture`.
- [x] 3.4 Default `listQueue` returns queued + filed. Verdict reject still works on queued or filed.

## 4. Assist

- [x] 4.1 Move token-overlap scoring into assist. `pickTopic` uses title + prompt. Retrieve still uses FTS + token overlap on item text.

## 5. Extension

- [x] 5.1 Policy tab: one textarea, debounce PUT on input. Delete chip lists and include/exclude handlers.
- [x] 5.2 Filings: show a Queued badge; keep reject. Default list includes queued.

## 6. Tests and docs

- [x] 6.1 Rewrite policy/capture/queue tests for prompt + queued/file/reject. Mock the LLM. Empty prompt drops. LLM error stays queued.
- [x] 6.2 Update README (workflow, policy, activity log, conventions). Drop leftover include/exclude language.
