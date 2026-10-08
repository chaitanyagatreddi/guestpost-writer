# Architecture

## Stack

Google Sheet + Apps Script + OpenAI API (`gpt-4o-mini`) + Google Docs.

No server, no hosting, no extra accounts. The LLM client speaks the chat-completions format, so `LLM_ENDPOINT` and `LLM_MODEL` in the Config tab can point at any service that accepts it.

## Files

```
src/
  Config.gs       — Tab layouts, settings and defaults
  Prompts.gs      — Every prompt
  Code.gs         — Menu, pipeline map, the six steps (entry points)
  Core.gs         — Run engine, trace-back, table access, fetch, LLM client, Doc writer
  Helpers.gs      — Pure utilities: numbers, keywords, similarity, HTML, URLs, JSON
  Tests.gs        — Self-test for Helpers
  appsscript.json — Manifest (only needed with clasp)
tests/
  run.js, mocks.js — End-to-end test under Node
PRD.md          — Product requirements (v3, 2-day build)
MILESTONES.md   — Build plan and what "done" means for each part
ARCHITECTURE.md — This file
SETUP.md        — How to install
README.md       — How to run, and what to do when it fails
```

`Core.gs` and `Helpers.gs` contain nothing about guest posts. The other three are the project.

## Data flow

```
GSC export (CSV)  ──►  Queries / Pages tabs
Sitemap URLs      ──►  Sitemap tab
Target pubs       ──►  Publications tab
                           │
              ┌────────────┼──────────────────────┐
              ▼            ▼                      ▼
        Step 1: Opps   Step 5a: plan angles   Step 6: broken links
        Step 2: Links  Step 5b: write copies   (Sitemap → _Links → Broken Links)
        Step 3: Topics  └► Google Docs + similarity
        ── founder approves ──
        Step 4: Draft ──► Google Doc
```

1. **Input:** a person pastes the GSC export, sitemap URLs and publications into their tabs.
2. **Processing:** Apps Script filters (position 8–20, low CTR), matches pages by keyword, and calls the LLM for topics, briefs and drafts.
3. **Output:** lists in the Sheet, drafts as Google Docs linked from the Drafts tab.

The Sheet is the only database. Every step reads its input from tabs and writes its result to tabs, which is what makes each step safe to run again.

## Tabs

| Tab | Filled by | Holds |
|---|---|---|
| Config | Setup, then you | Settings, one per row |
| Queries, Pages | You | GSC export |
| Sitemap | You or Import sitemap; step 6 adds status and title | Our page URLs |
| Publications | You | Guest-post targets |
| Opportunities | Steps 1 and 2 | Opportunities and link suggestions |
| Topics | Step 3; founder sets Status | Topic ideas |
| Drafts | Steps 4 and 5b; you set Status, Approved By, Approved Date | One row per Google Doc |
| Copies | You add a URL; 5a and 5b fill the rest | One brief per copy |
| Broken Links | Step 6 | Broken URLs and fixes |
| Run Log | Every run | One row per stage: OK, FAIL, PAUSED, CACHED |
| _Links, _Sources (hidden) | Steps 6 and 5a | Every internal link found; saved article text |

Code finds columns by header name, so columns can be moved. New columns are only ever added at the end.

## The run engine (Core.gs)

A step is a list of stages. `runStep_(key)` does this:

1. Takes a document lock, so two people cannot run at once.
2. Saves a marker that says "interrupted". If Google kills the run, the marker is what Resume finds.
3. **Pre-flight:** walks upstream through the pipeline map and stops if anything required is missing.
4. Runs each stage and writes a Run Log row when it finishes or fails.
5. Saves the outcome: `ok`, `paused`, `blocked` or `failed`, with the failing stage and the last good one.

Stages get a `ctx` with four tools:

| Tool | Use |
|---|---|
| `ctx.step(label, fn)` | A named sub-step, logged on its own. This is how a failure points at "Topic 3: create Google Doc" and not just "step 4". |
| `ctx.cached(label, seed, fn)` | For anything paid or slow. The result is kept for 6 hours under a hash of `seed`, so a re-run reuses it. |
| `ctx.forget()` | Call when an item is fully done, so the same input gives fresh output next time. |
| `ctx.checkTime(progress)` | Call inside loops. Pauses the step at 4.5 minutes, before the 6-minute limit. |

### Why resume works

There is no saved program counter. Resuming is running the step again, and three properties make that safe:

- **Cheap stages run again.** Reading, filtering and matching take seconds.
- **Batch stages are idempotent.** Each row carries its own status (`Planned` → `Drafted`, a blank status code → `200`), so finished rows are skipped.
- **Paid calls are cached.** If the LLM answered but the next sub-step failed, the answer is reused.

This is sturdier than recording a position, because the Sheet may have been edited between the failure and the retry.

## The pipeline map and trace-back (Code.gs)

`pipeline_()` lists every input, human gate and step as a node:

```js
drafts: {
  label: '4. Draft Approved Topics',
  needs: ['apiKey', 'approval'],     // must be good first
  soft:  ['sitemap'],                // helps, does not block
  verify: function() { ... },        // "is this done?", answered from the Sheet
  fix:   'Run Guestpost Writer → 4. Draft Approved Topics.',
  stages: [{ name: 'Write drafts', run: stageDraftTopics_ }]
}
```

```
tabs ─┬─ gsc (soft) ──────┐
      ├─ sitemap ─────────┼─► opportunities ─► links
      ├─ publications ────┤                      │ (soft)
      │            apiKey ┴─► topics ◄───────────┘
      │                         └─► approval (person) ─► drafts
      ├─ copyRequest (person) ─► copyPlan ─(soft)─► copyDrafts ─(soft)─► similarity
      └─ sitemap ─► brokenLinks
```

The two soft arrows in the copies row are deliberate: one unreadable page should not stop the other copies from being written, and similarity can be re-checked while some copies are still waiting.

`traceBack_(key)` checks a node's ancestors in dependency order. The last one that passes is the last good step; the first required one that fails is where the problem starts. The same function powers three things:

- the pre-flight check before every run,
- the "Trace back" list in every failure report,
- **Resume**, which runs the first failing step, or names the person who has to act.

Because `verify` reads the Sheet and not a saved flag, the trace is true even if someone cleared a tab by hand.

## Step notes

- **Step 1.** Site-average CTR is total clicks ÷ total impressions, not the mean of per-page CTRs. CTR is accepted as `3.2%`, `0.032` or `3.2`.
- **Step 2.** Keyword match on page title and URL slug. No LLM call. Until step 6 has fetched titles, matching uses slugs alone.
- **Step 3.** One LLM call. Links the LLM returns are dropped unless they are in the Sitemap tab, and the row's Data Note says so.
- **Steps 4 and 5b.** The Markdown the LLM returns becomes a formatted Doc: headings, lists, bold, links, and yellow highlight on `[NEEDS SOURCE]` and `[FOUNDER STORY]`.
- **Step 5.** Call A plans all briefs in one request. Call B writes each copy separately and is shown the other briefs so it can stay away from them. Similarity is the share of 3-word phrases the shorter text has in common with the other, checked for every pair and for each copy against the source.
- **Step 6.** Sitemap URLs are fetched with redirects off and errors muted, in batches with a pause. Internal links are pulled from each live page and each unique one is checked once. Pages in the GSC export but not the sitemap are checked too. 404 and 410 count as broken; other errors are listed as "could not confirm".

## Config

Settings live in the **Config** tab; defaults are in `SETTINGS` in `Config.gs`. One value lives in Script Properties:

| Key | What |
|---|---|
| `LLM_API_KEY` | API key. Never written to a cell. |

## Limits

- Apps Script: 6 minutes per run → long jobs pause and continue.
- URL Fetch: 20k/day (consumer), 100k/day (Workspace).
- Docs created: 250/day (consumer), 1,500/day (Workspace).
- Cache: results over 100 KB are not cached and would be fetched again on a retry.
- LLM cost grows with the number of drafts (one call each).

## What it does NOT do

- Auto-publish or auto-send pitches.
- Modify the live site. Step 6 only lists fixes.
- Store the API key in a cell.
- Run on a schedule. Every run starts from a menu click.
- Topic clusters, pillar pages, or a ranking feedback loop. Those are outside the 2-day build.
