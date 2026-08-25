---
id: simplify-product
status: accepted
features: [ui, policy, capture]
created: 2026-08-24
---

# Significantly simplify Dossier

## Why

The product is heavier than the job. Establishing a topic means chatting a YAML policy into existence, accepting a diff, then waiting on embed/judge jobs that park pages in an inbox. The useful loop is: name a topic, say what belongs, pick sites, see what was captured.

## What changes

- **Topics list stays.** Creating, opening, and deleting topics is unchanged. Each row has a button that adds the current page’s site to that topic.
- **Sidebar is the UI.** Clicking the extension icon opens or closes the side panel. There is no toolbar popup. A capture on/off slider in the panel header replaces pause/resume buttons.
- **No Pin.** Remove **Pin this page**, the background `pin` handler, the context-menu **File this page** item, and Assist's Pin (save-this-thread).
- **No Chat tab.** Remove the topic-editor Chat tab, the chat-based policy/outline flow, and the `/topics/:id/chat` surface.
- **Policy is first and only.** Topic tabs become **Policy | Sites | Filings**, Policy selected by default. The Policy tab is a live include/exclude list editor (add/remove terms), not a YAML textarea. Edits apply immediately — no propose, accept, or save. Drop policy fields `rank`, `extract`, `voice`, `deploy`, and `hosts`. Sites remain the only control for where capture runs.
- **No Brief.** Remove the Brief tab, brief rendering, and markdown export.
- **Capture stores the page.** A watched page that matches the policy is saved as-is (title, url, readable text, highlight). No embed, judge, extract, or outline filing as part of capture.
- **No inbox.** Matching pages become captured filings immediately. Non-matching pages are dropped, not queued. The Filings tab lists captured summaries (title, snippet, url, time) with dismiss/reject — no keep, refile, or file-to-section.
- **Tabs look like tabs.** Policy, Sites, and Filings use a modern tab strip (shared underline/selected state, not a row of independent buttons).
- **Schema and server cut to what remains.** New schema, no migrations, no leftover columns or routes. Existing local DBs are discarded on version mismatch. Delete modules and config that only served chat, YAML, jobs, embeddings, inbox, brief, or pin.

## Scope

- In: side panel topic editor and tabs; all Pin paths (popup, context menu, Assist); policy model and API (include/exclude, immediate write); capture ingest without the job pipeline; filings list without inbox (summaries + dismiss/reject); brief/chat/outline/proposal removal; visual tab treatment; rewrite schema and drop unused server/API/config
- Out: Assist reply/draft (minus Pin; retrieve becomes keyword/FTS only); dwell/denylist/pause/incognito rules; site add/remove and host permissions; topic CRUD; native-messaging / token handshake; new capture sources; migrating old DBs or YAML policies

## Impacted specifications

- `ui` (new)
- `policy` (new)
- `capture` (new)

## Decisions

- **Empty include list.** Match nothing until the topic has at least one include term. Exclude terms still drop matches.
- **Filings actions.** Summaries plus dismiss/reject. No keep, refile, or file-to-section.
- **Pin.** Remove every pin path, including Assist Pin.
- **No compatibility.** Do not migrate data or keep unused tables, columns, routes, or config keys.
