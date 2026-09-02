---
id: calibrate-scope-judge
created: 2026-09-02
updated: 2026-09-02
---

# Plan: File pages that are plausibly in scope

| Created | Updated |
| --- | --- |
| 2026-09-02 | 2026-09-02 |

## 1. Prompt and judge call

- [x] 1.1 Rewrite `PROMPT_SCOPE`: file when plausibly about the topic, title is strong evidence, related subtopics count, false only when clearly unrelated. JSON only. No "if unsure, false". No `decide_scope`.
- [x] 1.2 `askScope` uses `json: true` and does not send tools. Drop `SCOPE_TOOL`. User and retry text ask for `{"in_scope": true|false}`. Unparseable still stays queued.

## 2. Tests

- [x] 2.1 Replace the tool-call test with an assertion that the judge chat sets `json: true` and omits tools.
- [x] 2.2 Keep file/reject and queued-on-failure coverage.

## Change history

| Date | Change |
| --- | --- |
| 2026-09-02 | Initial plan |
| 2026-09-02 | All items done |
