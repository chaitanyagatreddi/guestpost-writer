# Guestpost Writer

One Google Sheet that turns a Search Console export into opportunities, internal-link ideas, topic ideas and ready-to-edit drafts in Google Docs. It also turns one blog post into 5–10 different pieces, and lists broken links on our site.

It only writes drafts and lists. It never publishes, never sends a pitch and never changes the site.

**Status:** all six steps are built and pass 110 automated checks against mocked Sheets, Docs and LLM (`node tests/run.js`). It has not yet been run in a live Sheet — see [MILESTONES.md](MILESTONES.md) for what is left to confirm.

## Run it in 5 lines

1. Paste the GSC export into **Queries** and **Pages**, page URLs into **Sitemap**, and guest-post targets into **Publications**.
2. Menu **Guestpost Writer** → run **1**, **2**, **3** in order.
3. A founder sets **Status** to `Approved` on a row in **Topics**. Then run **4**.
4. Open the Doc from **Drafts**. Fill every yellow `[NEEDS SOURCE]` and `[FOUNDER STORY]`, then send it for founder review. You send the pitch yourself.
5. If anything stops, choose **Resume from last successful step**.

First time? Follow [SETUP.md](SETUP.md) — about 15 minutes.

## The flow

```
 GSC export ─┐
 Sitemap ────┼─► 1. Find Opportunities ─► 2. Suggest Internal Links ─► 3. Generate Topics
 Publications┘                                                              │
                                                              Founder approves a topic   (person)
                                                                            │
                                                              4. Draft → Google Doc
                                                                            │
                                                       You fact-check → founder reviews   (person)
                                                                            │
                                                              You pitch / publish         (person)

 Run any time, on their own:
   5a. Blog URL → plan angles ─► (edit briefs) ─► 5b. Write copies, one Doc each ─► similarity check
   6.  Check Broken Links ─► Broken Links tab
```

## What each menu item does

| Menu item | Reads | Writes | Then |
|---|---|---|---|
| **1. Find Opportunities** | Queries, Pages | Opportunities: queries at position 8–20 with 10+ impressions; pages whose CTR is under half the site average | Run 2 |
| **2. Suggest Internal Links** | Opportunities, Sitemap | A target page, up to 3 pages to link from, and an anchor, on each Opportunities row | Run 3 |
| **3. Generate Topics** | Opportunities, Sitemap, Publications | 5 new rows in Topics: title, angle, query, author, publication and why, pages to link, fit score | Founder sets Status to `Approved` |
| **4. Draft Approved Topics** | Approved rows in Topics | One Google Doc per topic (outline, ~1,000 words, 1–2 links, yellow tags) and a row in Drafts | Fact-check, then founder review |
| **5a. Blog → Plan Copy Angles** | Copies rows with a Source URL and no Status | 5–10 briefs in Copies, each with its own angle, author, publication, format and length | Edit any brief, then run 5b |
| **5b. Blog → Write Copies** | `Planned` rows in Copies | One Doc per copy, a row in Drafts, and a Similarity Flag | Rewrite anything marked `TOO CLOSE` |
| **5c. Blog → Re-check Similarity** | Copy Docs as they are now | Fresh Similarity Flags | Use after editing copies |
| **6. Check Broken Links** | Sitemap, links on those pages, Pages | Broken Links: each broken URL, who links to it, GSC impressions, a suggested replacement and what to do | Fix on the site by hand |

A few things worth knowing:

- **Little GSC data is fine.** With fewer than 5 opportunities, step 1 says `LOW DATA` and step 3 picks topics on fit — publications, author angles and our pages. Steps 5 and 6 do not need GSC at all.
- **Steps 4 and 5b write 3 drafts per click**, to stay under Google's 6-minute limit. Click again, or Resume, for the next batch.
- **A page that cannot be read** (blocked, or built with JavaScript) is marked `Paste needed`. Paste the article into that row's **Pasted Text** cell and run 5a again.
- **Each copy goes to one publication only.** Publications want original, unpublished pieces. If the source is someone else's blog, treat it as a brief: do not reuse its wording or claims.
- **Step 2 suggests up to 3 pages.** A query that matches no page is marked as a content gap — often a good topic.

## When something fails

Every step is a list of small stages, and each stage writes a row in the **Run Log** tab as it finishes. So a failure always tells you the last thing that worked and the thing that broke:

```
✗ 4. Draft Approved Topics — failed

Failed at: Write drafts › Topic 1: create Google Doc
Last successful step: Write drafts › Topic 1: LLM draft
Error: Service Documents failed while accessing document

Trace back from this step:
✓ LLM API key — saved in Script Properties
✓ Tabs set up — 13 tabs
✓ GSC export pasted — 5 queries, 5 pages
✓ 1. Find Opportunities — 5 opportunities
✓ Publications list — 2 publications
✓ Sitemap URLs — 6 URLs
✓ 2. Suggest Internal Links — 5 opportunities have suggestions
✓ 3. Generate Topics — 4 topics
✓ Founder approves a topic — 2 approved
✗ 4. Draft Approved Topics — 2 approved topic(s) have no draft yet
     Fix: Run Guestpost Writer → 4. Draft Approved Topics.
```

What to do:

1. Read the **Fix** line and do it.
2. Choose **Resume from last successful step**. It walks back up the chain, finds the first thing that is not done, and starts there. If that thing needs a person — a founder approval, a pasted article — it tells you who and what instead of running.
3. Nothing is paid for twice. A finished row is skipped. An LLM draft that was already written is kept for 6 hours and reused, so in the example above the retry creates the Doc without calling the LLM again.

**Where did it break? (status)** shows the same report at any time, plus a tick or cross for every step.

| You see | It means | Do this |
|---|---|---|
| `can't run yet` | Something upstream is missing | Follow the Fix line |
| `failed` | A stage threw an error | Follow the Fix line, then Resume |
| `paused` | The batch is done, or time ran short | Run the same item again, or Resume |
| `stopped before it finished` | Google ended the run at 6 minutes, or the tab was closed | Resume |
| `LLM error 401` | The API key was rejected | Setup → Set LLM API key |
| `LLM error 429` | Rate limit or spending cap | Check usage with the provider, wait, Resume |

## Settings

Everything adjustable is in the **Config** tab, one row per setting with a note on what it does. The ones you are most likely to touch:

| Key | Default | Change it when |
|---|---|---|
| `IMPRESSION_THRESHOLD` | 10 | Step 1 finds too few or too many opportunities |
| `LOW_CTR_RATIO` | 0.5 | You want more (raise) or fewer (lower) low-CTR pages |
| `SIMILARITY_THRESHOLD` | 0.25 | Copies are flagged too often or not often enough |
| `DRAFTS_PER_RUN` | 3 | Runs pause too early or hit the time limit |
| `MONEY_PAGES` | blank | Drafts should link to specific pages |
| `ABOUT`, `AUTHORS` | Something, Aankit, Shinjan | The product or the author angles change |
| `LLM_MODEL` | `gpt-4o-mini` | You switch model |

The API key is the one thing that is not in a cell. It is saved in Script Properties through **Setup → Set LLM API key**. Use a key with a spending cap set at the provider.

## Files

```
src/
  Config.gs    Tab layouts and settings                          ← project-specific
  Prompts.gs   Every word sent to the LLM                        ← project-specific
  Code.gs      Menu, the pipeline map, the six steps             ← project-specific
  Core.gs      Run engine, trace-back, tables, network, LLM, Docs   ← reusable as is
  Helpers.gs   Text, URL, HTML and similarity utilities          ← reusable as is
  Tests.gs     Self-test for the helpers (Setup → Run self-test)
tests/
  run.js       End-to-end test under Node, everything mocked
  mocks.js     Stand-ins for Sheets, Docs, UrlFetch, Cache, Properties
```

More detail: [ARCHITECTURE.md](ARCHITECTURE.md). Requirements: [PRD.md](PRD.md). Build plan: [MILESTONES.md](MILESTONES.md).

## Reusing this as a template

`Core.gs` and `Helpers.gs` know nothing about guest posts. To build another Sheet tool, copy them and write three things.

**1. Tabs and settings** in `Config.gs`:

```js
TABS['Leads'] = ['Company', 'Website', 'Status', 'Summary'];
SETTINGS.push(['BATCH_SIZE', 5, 'Rows handled per click']);
```

**2. A node in `pipeline_()`** in `Code.gs`. `needs` is what must be done first, `verify` answers "is this done?", and `stages` is the work:

```js
summaries: {
  label: 'Summarise leads', needs: ['tabs', 'apiKey'], fix: 'Run My Tool → Summarise leads.',
  verify: function() {
    var todo = readTable_('Leads').filter(function(r) { return !r.summary; }).length;
    return todo ? no_(todo + ' leads have no summary') : ok_('all leads summarised');
  },
  stages: [{ name: 'Summarise', run: stageSummarise_ }]
}
```

**3. The stage and a menu function:**

```js
function stageSummarise_(ctx) {
  var done = 0;
  readTable_('Leads').filter(function(r) { return !r.summary; }).forEach(function(lead) {
    ctx.checkTime(done + ' done. Run again to continue.');            // pause before the 6-minute limit
    var prompt = 'Summarise this company in one line: ' + lead.company;
    var summary = ctx.cached(lead.company + ': LLM', prompt, function() { return callLLM_(prompt); });   // never paid for twice
    ctx.step(lead.company + ': save', function() { updateRow_('Leads', lead._row, { summary: summary }); });
    ctx.forget();                                                     // this row is finished
    done++;
  });
  return done + ' leads summarised.';
}

function summariseLeads() { return runAndShow_('summaries'); }
```

That gives the new step the Run Log, the failure report, trace-back, pause and resume without writing any of it. Three rules keep resume honest:

- Mark each row done as you finish it, so a re-run skips it.
- Put every paid or slow call inside `ctx.cached()`.
- Throw with `fail_(message, fix)` so the person sees what to do next.

## Tests

```
node tests/run.js           # 110 checks, no install, no network, no API key
node tests/run.js --show    # also prints the messages a person would see
```

The tests load the real `src/*.gs` files and run all six steps against a fake site, blog and LLM. They cover the low-data path, a rejected API key, a Docs failure followed by resume, batching, the paste fallback, similarity flags and the broken-link report.

## Limits

- 6 minutes per run (Apps Script). Long jobs pause and continue on the next click.
- 20,000 URL fetches and 250 new Docs a day on a consumer account; 100,000 and 1,500 on Workspace. [Google's quota page](https://developers.google.com/apps-script/guides/services/quotas) has the current numbers.
- The GSC screen export gives at most 1,000 rows per table.
- Pages built with JavaScript can hide their text and links from a simple fetch.
- LLM cost grows with the number of drafts: one call per draft, plus one planning call per blog URL.
- The tool cannot see links from other sites. If a broken URL might have them, add a 301 redirect even when the tool does not ask for one.
