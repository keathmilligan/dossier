---
feature: policy
---

# Policy

## Purpose

A topic's capture policy is two lists of terms: include and exclude. Sites decide where the policy applies.

## Requirements

### Shape

A policy SHALL consist only of include terms and exclude terms. It SHALL NOT include rank, extract, voice, deploy, or hosts.

### Immediate write

Creating a topic SHALL create an empty policy. Updating include or exclude SHALL persist immediately. There SHALL NOT be a propose, accept, save, or chat-based policy flow.

#### Empty on create

- GIVEN the user creates a topic
- WHEN the topic is opened
- THEN include and exclude are empty and sites can already be added

#### Live edit

- GIVEN a topic is open on Policy
- WHEN the user adds or removes a term
- THEN the stored policy matches the lists on screen without a further confirm

### Matching

A page matches a topic's policy when include is non-empty, at least one include term hits the title or body, and no exclude term hits. A term hit is a case-insensitive substring (including a long-enough token inside a phrase). An empty include list SHALL match nothing.

#### Empty include

- GIVEN a topic has sites and no include terms
- WHEN a page on those sites is a capture candidate
- THEN it is not captured

#### Include hit

- GIVEN a topic has include term "Manifest V3" and no excludes
- WHEN a watched page's title or body contains that term
- THEN the page matches

#### Exclude hit

- GIVEN a topic has an include term that hits and an exclude term that also hits
- WHEN the page is a capture candidate
- THEN the page does not match
