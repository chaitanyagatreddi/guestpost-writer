# PRD (2-day build) — Internal Guest Post Writer (v3)

## Goal

A Google Sheet that turns a GSC export into opportunities, internal-link ideas, topic ideas and ready-to-use drafts in Google Docs; turns one blog link into 5–10 genuinely different pieces; and finds broken links on our site. The tool only writes drafts — it never auto-publishes or auto-sends pitches.

In short:

- Turns GSC export into opportunities (striking-distance queries, low-CTR pages)
- Suggests internal links per opportunity
- LLM generates 5 topic ideas scored by fit
- One-click draft to Google Doc with [NEEDS SOURCE] / [FOUNDER STORY] tags
- Paste a blog link → 5–10 different copies, each in its own Doc
- 404 checker + broken link fix suggestions

## Build option

[Suggestion] Google Sheet + Apps Script calling an LLM API. One Sheet, native Docs creation, no extra accounts or hosting. (n8n/Make is the alternative but adds setup.)

Apps Script limits that matter here (Google's quota page): URL Fetch calls 20,000/day on consumer accounts, 100,000/day on Google Workspace; 6 minutes max per script run; Docs created 250/day (consumer) or 1,500/day (Workspace). Fine for our size; long jobs must run in batches. Source: developers.google.com/apps-script/guides/services/quotas.

## Before starting (have ready)

- GSC access, and agreement on which domain (something.cloud, trysomething.sh, or both).
- GSC Performance export, last 3 months: Queries + Pages tables (the GSC UI export only gives the top rows, up to 1,000 per table).
- Sitemap URL(s) → list of page URLs.
- LLM API key with a spending cap, stored in Script Properties (not in a cell).
- Guest-post target sheet; short notes on what Something does, money pages, and Aankit/Shinjan angles.

## Sheet tabs

Queries · Pages · Sitemap (url, title, status) · Publications · Opportunities · Topics · Drafts (topic, Doc link, status, source URL, similarity flag) · Copies (source URL, angle, author, publication, format, length) · Broken links (broken URL, status, linked from, in GSC?, suggested replacement, action)

## Steps 1–4

1. **Opportunities:** flag queries at position 8–20 with impressions above a low threshold (start ~10), and pages with low CTR vs site average → Opportunities.
2. **Internal links:** for each opportunity, 3 existing pages to link from/to by keyword match on URL/title, with a natural anchor.
3. **Topics:** one LLM call → 5 ideas with title, angle, target query, author (Aankit = founder journey; Shinjan = tech/AI agents), best-fit publication and why, pages to link. Prompt: "Use only the data given; do not invent statistics. Return JSON." + opportunities, pages, publications.
4. **Draft:** pick a topic → outline + ~1,000-word draft in a new Google Doc, 1–2 natural Something links, [NEEDS SOURCE] for any claim needing evidence, [FOUNDER STORY] where a real example belongs. Doc is ready to use.

## Step 5 — Paste a blog link → 5–10 different copies

Verdict: feasible — needs day 2 (~3 hours, estimate).

- **Input:** paste a URL and choose a number (5–10) in the Copies tab.
- **Fetch:** UrlFetchApp gets the page; a simple HTML-to-text step keeps the title, headings and paragraphs. Some pages block fetching or only load text with JavaScript — then the tool shows "couldn't read page, paste the text instead" and you paste the article into a cell.
- **Call A — plan angles:** one LLM call returns N distinct briefs. Prompt: "From this article, create {N} pieces that are clearly different from each other. Each must differ in: angle/main argument, examples, structure, title, author (Aankit = founder journey; Shinjan = tech/AI agents), target publication (from list), format (how-to, opinion, listicle, case study, LinkedIn post) and length. No two may share the same angle, format+author pair, or main examples. Return JSON." Results are written to Copies; the user can edit them before drafting.
- **Call B — one draft per brief** (separate calls, so each piece is written fresh). Prompt includes the brief, the instruction "Do not reuse sentences or examples from the source or other copies", plus the same [FOUNDER STORY] / [NEEDS SOURCE] and link rules as Step 4. Each copy → its own Google Doc + Drafts row.
- **Similarity check:** after drafting, compare every pair of copies (and each copy vs the source) by word-phrase overlap; flag any pair above a threshold (start ~25%, tune) as "too close — rewrite" in Drafts.
- Runs in batches (e.g. 2–3 drafts per run) so each run stays under the 6-minute limit.

Notes: publications usually want original, unpublished pieces — run a quick uniqueness check before pitching, and pitch each copy to only one place. If the source is someone else's blog, use it as a brief only; don't copy its wording or claims. AI cost grows roughly in line with the number of copies (1 planning call + 1 call per copy) — estimate only; check your provider's current pricing.

## Step 6 — 404 check + internal link suggestions

Verdict: feasible — needs day 2 (~2 hours, estimate). A lite version (sitemap URLs + GSC cross-check only, ~1 hour) could fit day 1 if setup goes fast.

- **Check sitemap URLs:** UrlFetchApp with muteHttpExceptions: true (so 404s don't stop the script) and followRedirects: false; record status (200, 301/302, 404, 5xx) in Sitemap.
- **Check links on those pages:** extract internal links from each live page's HTML, check each unique link once, and record which pages link to each broken one. (The same fetch can fill page titles for Step 2.)
- **GSC cross-check:** mark broken URLs that appear in the GSC Pages export with impressions — fix these first.
- **Suggest a fix:** closest live page by keyword match on URL/title → "update link on [page] to [new URL]", or "add a 301 redirect" if the old URL has impressions or outside links.

Notes: pages built with JavaScript may hide links from a simple fetch; some servers rate-limit, so add short pauses and run in batches. Quota is not a concern at our size (20,000+ fetches/day). The tool only lists fixes; it does not change the site.

## Plan — this is now more than one day (~12 hours, estimate)

**Day 1 (~7h): Steps 1–4**

1h setup (Sheet, tabs, imports, API key) · 2h opportunities + links · 2h topic + draft prompts · 1h end-to-end test · 1h fixes + "Run" menu + 5-line how-to.

**Day 2 (~5h): Steps 5–6**

1h Step 6 (status check, linked-from list, GSC cross-check) · 1h Step 6 suggestions + batching · 2h Step 5 (fetch, angle call, draft calls, Docs) · 1h similarity check + test on 2–3 real blog URLs.

## Risk: little GSC data

Something launched in 2026, so GSC may show few queries (unknown until exported). Fallback: run Step 3 on fit only (publications + author angles + our pages) and mark "low data". Steps 5 and 6 don't depend on GSC volume.

## Done when

- ☐ GSC data and sitemap list are in the Sheet; Opportunities lists 8–20 queries and low-CTR pages (or "low data").
- ☐ Each opportunity has 3 internal-link suggestions; one click gives 5 topics; one click gives a Doc with outline, draft, links, [NEEDS SOURCE] tags.
- ☐ Pasting a blog URL gives 5–10 copies, each in its own Doc + Drafts row, with different angle/author/format/publication/length; too-similar pairs are flagged.
- ☐ Unreadable pages show a clear "paste the text" message.
- ☐ Broken links tab lists each 404, the pages linking to it, whether it has GSC impressions, and a suggested replacement or redirect.
- ☐ Nothing is sent, published or changed on the site automatically; the intern can run it from the how-to.
