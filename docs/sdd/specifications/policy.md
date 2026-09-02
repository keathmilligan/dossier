---
feature: policy
created: 2026-08-24
updated: 2026-09-02
---

# Policy

| Created | Updated |
| --- | --- |
| 2026-08-24 | 2026-09-02 |

## Purpose

A topic's capture policy is a short prompt that describes what belongs. Sites decide where the policy applies.

## Requirements

### Shape

A policy SHALL consist of a single prompt string. It SHALL NOT include include/exclude term lists, rank, extract, voice, deploy, or hosts.

### Immediate write

Creating a topic SHALL create an empty policy. Updating the prompt SHALL persist immediately. There SHALL NOT be a propose, accept, save, or chat-based policy flow.

#### Empty on create

- GIVEN the user creates a topic
- WHEN the topic is opened
- THEN the prompt is empty and sites can already be added

#### Live edit

- GIVEN a topic is open on Policy
- WHEN the user edits the prompt
- THEN the stored policy matches the text on screen without a further confirm

### Empty prompt

An empty prompt (after trim) SHALL capture nothing. Sites may still be added.

#### Empty prompt drops

- GIVEN a topic has sites and an empty prompt
- WHEN a page on those sites is a capture candidate
- THEN it is not captured

## Change history

| Date | Change |
| --- | --- |
| 2026-08-24 | Include/exclude term lists |
| 2026-09-02 | Replaced term lists with a single prompt |
