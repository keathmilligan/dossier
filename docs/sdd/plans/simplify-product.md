---
id: simplify-product
---

# Plan: Significantly simplify Dossier

## 1. Schema and models

- [x] 1.1 Rewrite `service/src/db.ts` to the new tables only (`meta`, `topics`, `policies`, `topic_hosts`, `items`, `items_fts`, `filings`, `denylist`). Bump `SCHEMA_VERSION`. On version mismatch, close the DB, delete the sqlite file (and `-wal`/`-shm`), and open a fresh one.
- [x] 1.2 Slim `service/src/models.ts`: drop inbox/outline/chat/job/extract/pin types; policy is `{ include, exclude }`; filing state is `filed` | `rejected`; item source is `watching` | `manual`.

## 2. Policy

- [x] 2.1 Replace `policy.ts` with include/exclude normalize (trim, unique, reject blanks). No YAML, no diff.
- [x] 2.2 `createTopic` inserts an empty policy row. `PUT /topics/:id/policy` upserts include/exclude immediately. Topic GET returns those lists. Drop propose/accept/chat/structure.
- [x] 2.3 `addTopicHost` no longer requires an accepted policy. Drop `has_policy`; Sites is always available.

## 3. Capture and filings

- [x] 3.1 Ingest: denylist / incognito / length / pause unchanged. Match with `keywordHits` (non-empty include, at least one include hit, no exclude hit). Match → item + `filed` filing. Miss → no filing (and no item unless another topic matched).
- [x] 3.2 Do not enqueue jobs. Drop pin source and `origin`.
- [x] 3.3 Filings list returns `filed` newest-first (optional `include_rejected`). Verdict accepts only reject.

## 4. Delete unused server

- [x] 4.1 Delete `brief.ts`, `export.ts`, `chat.ts`, `jobs.ts`, `judge.ts`, `embeddings.ts`. Fold term matching into capture/policy; delete `filter.ts` if nothing remains.
- [x] 4.2 Remove routes: chat, policy propose/accept, structure, brief, export.md, assist/pin, compositions, jobs/drain. Strip topic PATCH of intent/venues/auto_accept.
- [x] 4.3 Slim `topics.ts` / `store.ts` (no nodes, inbox, embeds, jobs, proposals). Remove the job tick and `requeueFilteredFilings` from `index.ts`.
- [x] 4.4 Uninstall `yaml`, `diff`, and `@types/diff` from the service.

## 5. Config and LLM

- [x] 5.1 Drop `[filter]`, `capture.auto_accept_confidence`, `llm.embed_model`, and `migrateLegacyConfig`.
- [x] 5.2 Remove `embed()` from `LlmClient` / `OllamaClient`.

## 6. Assist

- [x] 6.1 Drop pin ingest, embeddings, extracts, and voice. Topic pick and retrieve use include terms + FTS. Keep `/assist` draft/gap.
- [x] 6.2 Remove Assist Pin and Keep from `assist.ts` (extension), `/assist/pin`, `/compositions`, and the worker pin/keep handlers. Drop the denylist “unless you Pin” copy.

## 7. Extension UI

- [x] 7.1 Panel tabs: **Policy | Sites | Filings**, Policy default. Remove Chat and Brief. Modern tab strip (underline / selected state).
- [x] 7.2 Policy tab: live include/exclude chip lists; add/remove calls `PUT` immediately.
- [x] 7.3 Sites always shown. Filings: title, snippet, url, time, reject. Drop keep / refile / section keys / in-flight / poll-for-jobs.
- [x] 7.4 Popup: remove **Pin this page**. List all topics. Context menu: remove **File this page**.
- [x] 7.5 Toolbar icon toggles the side panel (no popup). Move token/first-run into the panel.
- [x] 7.6 Topics list: per-topic button adds the current page’s site.
- [x] 7.7 Header slider replaces pause/resume (on = capturing).

## 8. Tests and docs

- [x] 8.1 Rewrite `policy.test.ts` and capture/policy/site/filings cases in `api.test.ts`. Delete `judge.test.ts` and embedding/filter cases. Slim `harness.ts` and `filter.test.ts` (or delete). Assist tests: no pin, no private leak-via-pin.
- [x] 8.2 `npm test` and `npm run typecheck` in service and extension.
- [x] 8.3 Update `README.md` to the new loop (policy lists, sites, auto-capture, no chat/brief/pin/inbox).
