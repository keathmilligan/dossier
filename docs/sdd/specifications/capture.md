---
feature: capture
created: 2026-08-24
updated: 2026-09-02
---

# Capture

| Created | Updated |
| --- | --- |
| 2026-08-24 | 2026-09-02 |

## Purpose

Watched pages on a topic's sites are stored and shown as filings. The model files pages that belong in the topic and rejects the rest.

## Requirements

### Ingest

A watching capture SHALL be considered only for topics that list the page's host and have a non-empty prompt. Existing denylist, incognito, minimum length, and pause rules still apply. The service SHALL persist those pages as `queued` filings without embedding, extracting, or filing into an outline.

#### Queue stores the page

- GIVEN a topic lists example.com and has a non-empty prompt
- WHEN the page is ingested from watching
- THEN an item and a `queued` filing for that topic are stored with the page title, url, and readable text

#### Empty prompt drops

- GIVEN a topic lists the host but the prompt is empty
- WHEN the page is ingested from watching
- THEN no item or filing is created for that topic

#### Re-ingest keeps state

- GIVEN an existing filing for an `(item, topic)` pair
- WHEN the same page is ingested again
- THEN the filing state is not reset

### Judge

The service SHALL ask the configured language model whether each `queued` page is in scope for the topic prompt, using the page title and body. The title SHALL count as strong evidence. Related subtopics SHALL count as in scope. A page that is plausibly about the topic SHALL become `filed`. A page that is clearly unrelated SHALL become `rejected`. Unparseable model output or a model error SHALL leave the filing `queued` for a later retry. The service SHALL NOT drop or auto-file on model failure. Editing the prompt SHALL NOT re-judge already queued, filed, or rejected rows; new pages use the current prompt.

#### Plausible match files

- GIVEN a queued page whose title or body is about the topic prompt
- WHEN the model judges it
- THEN the filing becomes `filed`

#### Unrelated rejects

- GIVEN a queued page that is clearly unrelated to the topic prompt
- WHEN the model judges it
- THEN the filing becomes `rejected`

#### Model down stays queued

- GIVEN a queued page and the language model is unavailable or returns junk
- WHEN the judge runs
- THEN the filing remains `queued`

### Filings

The filings list SHALL return `queued` and `filed` items newest first. Reject SHALL set the filing to `rejected` and hide it from the default list. Keep, refile, file-to-section, and a user inbox SHALL NOT exist.

#### Reject

- GIVEN a queued or filed capture is shown
- WHEN the user rejects it
- THEN it is `rejected` and absent from the default filings list

### Schema

The service SHALL use the current schema only. On schema-version mismatch it SHALL replace the local database. It SHALL NOT migrate old rows, YAML policies, or unused tables.

### Pin

Capture SHALL NOT accept a pin source. Assist SHALL NOT persist a thread via pin.

## Change history

| Date | Change |
| --- | --- |
| 2026-08-24 | Match-at-ingest against include/exclude; immediate `filed` |
| 2026-09-02 | Queue then judge against the topic prompt; file plausible matches |
