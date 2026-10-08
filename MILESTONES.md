# Milestones

The build plan from [PRD.md](PRD.md), cut into parts that can each be checked on their own. Hours are the PRD's estimates.

Each milestone has three checks, in this order:

- **Built** — the code is written.
- **Tested** — it passes `node tests/run.js`, which runs the real code against mocked Sheets, Docs, site and LLM.
- **Live** — someone has run it in the real Sheet with real data and seen the result. Only a person can tick this.

Everything is Built and Tested. Nothing is Live yet: that needs the Sheet, a GSC export and an API key.

| # | Milestone | Est. | Built | Tested | Live |
|---|---|---|---|---|---|
| M0 | Setup: Sheet, tabs, imports, API key | 1h | ✓ | ✓ | ☐ |
| M1 | Steps 1–2: opportunities and internal links | 2h | ✓ | ✓ | ☐ |
| M2 | Steps 3–4: topics and drafts | 2h | ✓ | ✓ | ☐ |
| M3 | End-to-end run, Run menu, how-to | 2h | ✓ | ✓ | ☐ |
| M4 | Step 6: status check, linked-from, GSC cross-check | 1h | ✓ | ✓ | ☐ |
| M5 | Step 6: fix suggestions and batching | 1h | ✓ | ✓ | ☐ |
| M6 | Step 5: fetch, plan angles, write copies | 2h | ✓ | ✓ | ☐ |
| M7 | Similarity check, tried on 2–3 real blog URLs | 1h | ✓ | ✓ | ☐ |

Day 1 is M0–M3 (~7h). Day 2 is M4–M7 (~5h).

## The rule

Do them in order, and do not start a milestone until the one before it is ticked Live. When one fails, do not push on: open **Where did it break? (status)**, find the last tick, and fix the first cross. That is the same trace-back the tool does for a failed run, applied to the build.

M4–M7 do not depend on M1–M3. If Day 1 is stuck on thin GSC data, Day 2 can go ahead.

## M0 — Setup (1h)

Follow [SETUP.md](SETUP.md).

Done when:
- ☐ The Guestpost Writer menu appears and **Setup → Create / repair tabs** makes 11 visible tabs.
- ☐ **Setup → Test LLM connection** says "Working".
- ☐ **Setup → Run self-test** says all checks passed.
- ☐ GSC data is in Queries and Pages; the sitemap list is in Sitemap; Publications has rows.
- ☐ Status shows a tick for: Tabs set up, LLM API key, GSC export pasted, Sitemap URLs, Publications list.

Before you start, agree which domain the export covers: something.cloud, trysomething.sh, or both.

## M1 — Opportunities and internal links (2h)

Done when:
- ☐ **1. Find Opportunities** lists queries at position 8–20 and low-CTR pages — or says `LOW DATA`.
- ☐ Spot-check three rows against the GSC screen: position, impressions and CTR match.
- ☐ **2. Suggest Internal Links** fills Target Page, Link From 1–3 and Anchor.
- ☐ Spot-check three suggestions: would you really add that link?

Tune if needed: `IMPRESSION_THRESHOLD`, `POSITION_MIN`, `POSITION_MAX`, `LOW_CTR_RATIO`.

Tested by: "step 1: opportunities", "low data", "step 2: internal links".

## M2 — Topics and drafts (2h)

Done when:
- ☐ **3. Generate Topics** adds 5 rows, each with title, angle, target query, author, publication and why, pages to link, score.
- ☐ Authors fit their angle: Aankit on the founder journey, Shinjan on tech and AI agents.
- ☐ Every URL in Pages to Link is a real page of ours.
- ☐ With one topic set to `Approved`, **4. Draft Approved Topics** gives a Doc with an outline, a ~1,000-word draft, 1–2 links to our pages, and yellow `[NEEDS SOURCE]` / `[FOUNDER STORY]` tags.
- ☐ The draft contains no invented statistic, customer or case study. Read it properly — this is the check that matters most.

If the writing is off, edit `src/Prompts.gs`. Nothing else needs to change.

Tested by: "step 3: topics", "step 4: drafts, failure and resume".

## M3 — End to end (2h)

Done when:
- ☐ A fresh run of 1 → 2 → 3 → approve → 4 works without touching the script editor.
- ☐ Break something on purpose — clear the API key, or run 4 with nothing approved — and the message says what is wrong and how to fix it.
- ☐ **Resume from last successful step** continues after you fix it.
- ☐ Someone who has not seen the tool can run it from the 5-line how-to in the README.
- ☐ Nothing was sent, published or changed on the site.

## M4 — Broken links: checking (1h)

Done when:
- ☐ **6. Check Broken Links** fills Status Code for every Sitemap row.
- ☐ Broken Links lists each 404 with the pages that link to it.
- ☐ In GSC? and Impressions are right for two URLs you look up by hand.
- ☐ A URL you know is broken shows up. A URL you know redirects does not.

A lite version of this milestone — sitemap URLs and the GSC cross-check only — can fit Day 1 if setup goes fast.

## M5 — Broken links: fixes and batching (1h)

Done when:
- ☐ Each 404 has a Suggested Replacement that makes sense, or is blank when nothing is close.
- ☐ Action says "update the link on [page] to [new URL]", or "add a 301 redirect" when the URL has impressions.
- ☐ On a site big enough to hit the time limit, the run pauses and a second click finishes it. No URL is fetched twice.
- ☐ The live site is unchanged.

Tune if needed: `FETCH_BATCH`, `FETCH_PAUSE_MS`. Raise the pause if the server starts answering 429.

Tested by: "step 6: broken links".

## M6 — Blog → copies (2h)

Done when:
- ☐ A blog URL and a number in Copies, then **5a**, gives that many briefs, each different in angle, author, format, publication and length.
- ☐ You can edit a brief and **5b** uses your edit.
- ☐ **5b** makes one Doc per copy and one Drafts row per copy, three per click.
- ☐ A page that cannot be read shows "Couldn't read page … paste the text instead", and works once you paste.

Tested by: "step 5: blog → copies".

## M7 — Similarity, on real URLs (1h)

Done when:
- ☐ Tried on 2–3 real blog URLs, including one of ours and one that is not.
- ☐ Every copy has a Similarity Flag. Two copies you would call "the same piece" are marked `TOO CLOSE`.
- ☐ Copies you would call different are marked `OK`. If not, move `SIMILARITY_THRESHOLD` (start 0.25) and run **5c**.
- ☐ You would be comfortable pitching each copy to a different publication.

## Done — the PRD checklist

- ☐ GSC data and sitemap list are in the Sheet; Opportunities lists 8–20 queries and low-CTR pages (or "low data").
- ☐ Each opportunity has up to 3 internal-link suggestions; one click gives 5 topics; one click gives a Doc with outline, draft, links and `[NEEDS SOURCE]` tags.
- ☐ Pasting a blog URL gives 5–10 copies, each in its own Doc and Drafts row, with a different angle, author, format, publication and length; too-similar pairs are flagged.
- ☐ Unreadable pages show a clear "paste the text" message.
- ☐ Broken Links lists each 404, the pages linking to it, whether it has GSC impressions, and a suggested replacement or redirect.
- ☐ Nothing is sent, published or changed on the site automatically; the intern can run it from the how-to.

## Known gaps against the PRD

- **Input for step 5.** The PRD says to choose the number of copies in the Copies tab. That is what happens, in the "Copies Wanted" column. The tool accepts 1–10 rather than 5–10, so a cheap 1-copy trial run is possible.
- **Internal links.** The PRD asks for 3 pages per opportunity. The tool gives up to 3 — only pages that share a keyword with the query — and marks a query with no match as a content gap.
- **Outside links.** The PRD suggests a 301 "if the old URL has impressions or outside links". The tool can see impressions but not links from other sites.
- **Uniqueness check before pitching.** The PRD recommends one. The similarity check compares copies with each other and with the source; it does not search the web.
