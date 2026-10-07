# Setup

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → new blank spreadsheet.
2. Name it "Guestpost Writer".

## 2. Add the Apps Script

1. Extensions → Apps Script.
2. Delete the default `Code.gs` content.
3. Paste the contents of `src/Code.gs`.
4. Create a new file (`+` button) → name it `Helpers` → paste `src/Helpers.gs`.
5. Save (Ctrl+S).

## 3. Set Script Properties

1. In Apps Script: Project Settings (gear icon) → Script Properties → Add.
2. Add these:

| Property | Value |
|----------|-------|
| `LLM_API_KEY` | Your OpenAI API key |
| `LLM_MODEL` | `gpt-4o-mini` |
| `IMPRESSION_THRESHOLD` | `10` |

## 4. Create tabs

1. Reload the Sheet → the **Guestpost Writer** menu appears.
2. Click **Guestpost Writer → Setup: Create All Tabs**.
3. Authorize when prompted (first-time only).

## 5. Add data

- **Queries + Pages:** export from GSC (Performance → Export → Google Sheets or CSV), copy into the matching tabs.
- **Sitemap:** paste your sitemap URLs into the URL column.
- **Publications:** fill in your guest-post target list.

## 6. Run

Use the **Guestpost Writer** menu:

1. **Find Opportunities** — fills the Opportunities tab.
2. **Suggest Internal Links** — shows link suggestions.
3. **Generate Topics** — fills the Topics tab with 5 scored ideas.
4. **Draft Selected Topic** — select a row in Topics, click this → creates a Google Doc.
5. **Blog → Copies** — put a URL in the Copies tab, select the row, click this → creates 5 Docs.
6. **Check Broken Links** — checks all Sitemap URLs, fills Broken Links tab.
