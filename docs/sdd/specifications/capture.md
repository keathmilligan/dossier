---
feature: capture
---

# Capture

## Purpose

Watched pages that match a topic's policy are stored as-is and shown as filings.

## Requirements

### Ingest

A watching capture SHALL be considered only for topics that list the page's host. Existing denylist, incognito, minimum length, and pause rules still apply. The service SHALL persist matching pages without embedding, judging, extracting, or filing into an outline.

#### Match stores the page

- GIVEN a topic lists example.com and has an include term that hits the page
- WHEN the page is ingested from watching
- THEN an item and a `filed` filing for that topic are stored with the page title, url, and readable text

#### Miss drops

- GIVEN a topic lists the host but the page does not match the policy
- WHEN the page is ingested from watching
- THEN no item or filing is created for that topic

### Filings

A matching page SHALL become a `filed` filing immediately. There SHALL NOT be an inbox state. The filings list SHALL return `filed` items newest first. Reject SHALL set the filing to `rejected` and hide it from the default list. Keep, refile, and file-to-section SHALL NOT exist.

#### Reject

- GIVEN a filed capture is shown
- WHEN the user rejects it
- THEN it is `rejected` and absent from the default filings list

### Schema

The service SHALL use the current schema only. On schema-version mismatch it SHALL replace the local database. It SHALL NOT migrate old rows, YAML policies, or unused tables.

### Pin

Capture SHALL NOT accept a pin source. Assist SHALL NOT persist a thread via pin.
