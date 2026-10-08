# Setup

About 15 minutes. You need a Google account, Search Console access, and an LLM API key with a spending cap.

## 1. Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → new blank spreadsheet.
2. Name it "Guestpost Writer".

## 2. Add the Apps Script

1. In the Sheet: **Extensions → Apps Script**.
2. Delete what is in the default `Code.gs`, then paste the contents of `src/Code.gs`.
3. For each of the other five files, click **+ → Script**, give it the same name, and paste its contents:

   | New file | Paste from |
   |---|---|
   | `Config` | `src/Config.gs` |
   | `Core` | `src/Core.gs` |
   | `Helpers` | `src/Helpers.gs` |
   | `Prompts` | `src/Prompts.gs` |
   | `Tests` | `src/Tests.gs` |

4. Save (Ctrl+S). The order of the files does not matter.

Prefer the command line? Copy `.clasp.json.example` to `.clasp.json`, put in the script ID (Apps Script → Project Settings), and run `clasp push`.

## 3. Create the tabs

1. Reload the Sheet. The **Guestpost Writer** menu appears after a few seconds.
2. **Guestpost Writer → Setup → Create / repair tabs**.
3. Google asks for permission the first time: to edit this Sheet, create Docs, and call outside addresses (the LLM and the pages it checks). Allow it, then choose the menu item again.

This is safe to repeat. It only adds what is missing and never touches your data.

## 4. Save the API key

1. **Setup → Set LLM API key** and paste the key. It goes into Script Properties, not into a cell.
2. **Setup → Test LLM connection.** You should see "Working".

Anyone who can edit the Sheet's script can read the key, so share edit access with care.

## 5. Add the data

| Tab | What to put in |
|---|---|
| **Queries** | GSC → Performance → last 3 months → Export. Paste the Queries table at cell A1, header row included. |
| **Pages** | The Pages table from the same export. |
| **Sitemap** | Page URLs in the URL column. Or put the sitemap address in `SITEMAP_URLS` on the Config tab and run **Setup → Import sitemap**. |
| **Publications** | The guest-post target list. `Name` is required; the other columns help the LLM choose. |
| **Config** | Check `SITE_DOMAINS`, `ABOUT`, `AUTHORS` and `MONEY_PAGES`. |

Decide first which domain the export is for: something.cloud, trysomething.sh, or both. `SITE_DOMAINS` should list every domain you want treated as ours.

The GSC header says "Top queries" and "Top pages". That is fine — both names are understood.

## 6. Check it works

1. **Setup → Run self-test** → "All checks passed".
2. **1. Find Opportunities** → the Opportunities tab fills, or says `LOW DATA`.
3. **Where did it break? (status)** → a tick beside everything you have done so far.

Then follow the 5-line how-to in [README.md](README.md).

## Updating later

Paste the new file contents over the old ones and run **Setup → Create / repair tabs** once. New columns and settings are added; nothing is removed.

Moving from the first version (two files, settings in Script Properties)? Do the same. `IMPRESSION_THRESHOLD` and `LLM_MODEL` are copied from Script Properties into the Config tab the first time, and `LLM_API_KEY` stays where it is.
