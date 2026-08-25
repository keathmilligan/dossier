---
feature: ui
---

# UI

## Purpose

The side panel is the primary surface for topics, policy, sites, and filings.

## Requirements

### Side panel

The toolbar icon SHALL open the side panel when it is closed and SHALL close it when it is open. The extension SHALL NOT present a toolbar popup.

#### Icon toggle

- GIVEN the side panel is closed
- WHEN the user clicks the Dossier toolbar icon
- THEN the side panel opens

- GIVEN the side panel is open
- WHEN the user clicks the Dossier toolbar icon
- THEN the side panel closes

### Capture switch

The panel header SHALL provide a capture on/off switch. On means ingest is running. Off means ingest is paused. Assist SHALL remain available while paused.

#### Pause

- GIVEN capture is on
- WHEN the user turns the switch off
- THEN new watching captures are not ingested and the toolbar badge shows paused

### Topics list

The panel SHALL list topics. The user SHALL be able to create, open, and delete a topic. Each row SHALL offer a control that adds the current page's site to that topic when the site is eligible and not already on the topic.

#### Add current site

- GIVEN the current tab has a capturable host that is not on topic T
- WHEN the user clicks Add site on T
- THEN that host is added to T's site list

- GIVEN the current tab's host is already on topic T
- WHEN the topics list is shown
- THEN Add site on T is inactive

- GIVEN the current tab cannot be captured
- WHEN the topics list is shown
- THEN Add site is inactive on every topic

### Topic tabs

An open topic SHALL show tabs **Policy**, **Sites**, and **Filings**, with Policy selected by default. The tabs SHALL share a single selected/underline treatment. There SHALL NOT be Chat or Brief tabs.

### Policy tab

The Policy tab SHALL let the user add and remove include and exclude terms. Each change SHALL apply immediately.

### Sites tab

The Sites tab SHALL list the topic's hosts and allow adding a host by name or removing any host. Sites SHALL be available without a prior accept step.

### Filings tab

The Filings tab SHALL list captured summaries (title, snippet, url, time), newest first. The user SHALL be able to reject a capture. Rejected rows SHALL be hidden unless the user asks to show them. There SHALL NOT be keep, refile, or file-to-section actions.

### Pin

The UI SHALL NOT offer Pin this page, File this page, or Assist Pin.
