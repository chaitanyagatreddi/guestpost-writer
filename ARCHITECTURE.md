# Architecture

## Stack

Google Sheet + Apps Script + OpenAI API (gpt-4o-mini) + Google Docs.

No server, no hosting, no extra accounts.

## Files

```
src/
  Code.gs       — Menu, all 6 steps (entry points)
  Helpers.gs    — LLM calls, sheet parsing, text utils, prompt builders
PRD.md          — Product requirements (v3, 2-day build)
ARCHITECTURE.md — This file
SETUP.md        — How to install and run
```

## How it works

```
GSC export (CSV)  ──►  Queries / Pages tabs
Sitemap URLs      ──►  Sitemap tab
Target pubs       ──►  Publications tab
                           │
                    ┌──────┴──────┐
                    ▼             ▼
              Step 1: Opps    Step 6: 404s
              Step 2: Links   (broken link check)
              Step 3: Topics
              Step 4: Draft ──► Google Doc
                    │
                    ▼
              Step 5: Blog URL → 5–10 copies ──► Google Docs
```

## Data flow

1. **Input:** user pastes GSC CSV data into Queries + Pages tabs, sitemap URLs into Sitemap tab.
2. **Processing:** Apps Script reads sheet data, applies filters (position 8–20, low CTR), calls LLM for topics/drafts.
3. **Output:** opportunities in sheet, drafts as Google Docs linked from the Drafts tab.

## Config (Script Properties)

| Key | What | Default |
|-----|------|---------|
| `LLM_API_KEY` | OpenAI API key | — (required) |
| `LLM_MODEL` | Model ID | `gpt-4o-mini` |
| `LLM_ENDPOINT` | Chat completions URL | `https://api.openai.com/v1/chat/completions` |
| `IMPRESSION_THRESHOLD` | Min impressions for striking-distance | `10` |

## Limits

- Apps Script: 6 min max per run → long jobs batch automatically.
- URL Fetch: 20k/day (consumer), 100k/day (Workspace).
- Docs created: 250/day (consumer), 1,500/day (Workspace).
- LLM cost scales with number of drafts (~1 call per draft).

## What it does NOT do

- Auto-publish or auto-send pitches.
- Modify the live site.
- Store API keys in cells (uses Script Properties only).
