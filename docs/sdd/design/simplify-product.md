---
id: simplify-product
---

# Design: Significantly simplify Dossier

## Approach

Collapse policy to two string lists, apply them at ingest with a deterministic term match, persist matching pages without a job queue, and ship a new schema with no leftover tables or compatibility shims.

## Schema

Bump `SCHEMA_VERSION`. If the open DB's version does not match, replace the file and create the new schema. No `ALTER`, no column-keep, no data copy.

Keep:

- `meta`
- `topics` — `id`, `title`, `created_at`, `updated_at`
- `policies` — one row per topic: `id`, `topic_id` unique, `include_json`, `exclude_json`, `updated_at`
- `topic_hosts`
- `items` — `id`, `url`, `url_normalized`, `title`, `referrer`, `captured_at`, `dwell_ms`, `source` (`watching` | `manual`), `readable_text`, `highlight_text`
- `items_fts` — Assist retrieve
- `filings` — `id`, `item_id`, `topic_id`, `state` (`filed` | `rejected`), unique `(item_id, topic_id)`
- `denylist`

Drop tables: `policy_proposals`, `nodes`, `extracts`, `embeddings`, `chat_threads`, `chat_messages`, `compositions`, `jobs`.

Drop columns: topic `intent` / `status` / `venues_json` / `auto_accept_confidence`; policy `version` / `yaml_text` / `accepted_at`; item `origin` and `pin` source; filing `node_id` / `score` / `rationale` / `rank_in_node` / `pinned` / `verdict`.

## Server

- **Immediate policy write.** `PUT /topics/:id/policy` with `{ include, exclude }` upserts that topic's row. Creating a topic inserts empty lists so Sites works immediately. Capture still requires at least one include term.
- **Match at ingest.** Keep when (1) host is on the topic's site list, (2) include is non-empty, (3) at least one include term hits title or body, (4) no exclude term hits. Term hit = case-insensitive substring (`keywordHits`). Miss → no filing. Match → `filed`.
- **Filings.** List newest-first `filed` items. Reject flips state to `rejected` and hides the row. No keep / refile / sections / in-flight badges.
- **Pin gone.** Delete popup `#pin`, worker `pin` / `pinTab`, context-menu `file-page`, Assist Pin UI, and `POST /assist/pin`.
- **Assist Keep gone.** No UI lists compositions; drop Keep and `POST /compositions`.
- **Assist retrieve.** Keyword/FTS over captured items and include terms. No embeddings, no extracts table, no voice field.

Delete modules: `brief.ts`, `export.ts`, `chat.ts`, `jobs.ts`, `judge.ts`, `embeddings.ts`. Slim `policy.ts` to include/exclude parse-and-store (no YAML, no diff). Slim `filter.ts` to term matching or fold it into capture. Drop the job tick and `requeueFilteredFilings` from `index.ts`.

Remove routes: chat, policy propose/accept, structure apply, brief, export.md, assist/pin, compositions, jobs/drain. Stop accepting `intent` / `venues` / `auto_accept_confidence` on topic patch.

Config: drop `[filter]`, `capture.auto_accept_confidence`, `llm.embed_model`, and `migrateLegacyConfig`.

## Risks

- Existing local `dossier.sqlite` is wiped on first start after the bump. Expected.
- Assist drafts are thinner (FTS instead of embeddings). Accepted; capture no longer writes vectors.
- Empty include captures nothing even after sites are added. That is the stated rule.
