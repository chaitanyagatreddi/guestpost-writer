/**
 * Guestpost Writer — Google Sheet + Apps Script
 * Main entry point. Adds a custom menu and wires up all steps.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Guestpost Writer')
    .addItem('1. Find Opportunities', 'findOpportunities')
    .addItem('2. Suggest Internal Links', 'suggestInternalLinks')
    .addItem('3. Generate Topics', 'generateTopics')
    .addItem('4. Draft Selected Topic', 'draftSelectedTopic')
    .addSeparator()
    .addItem('5. Blog → Copies', 'blogToCopies')
    .addItem('6. Check Broken Links', 'checkBrokenLinks')
    .addSeparator()
    .addItem('Setup: Create All Tabs', 'setupTabs')
    .addToUi();
}

// ---------- Setup ----------

function setupTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabConfigs = {
    'Queries':      ['Query', 'Clicks', 'Impressions', 'CTR', 'Position'],
    'Pages':        ['Page', 'Clicks', 'Impressions', 'CTR', 'Position'],
    'Sitemap':      ['URL', 'Title', 'Status Code', 'Last Checked'],
    'Publications': ['Name', 'URL', 'Audience', 'Topics Accepted', 'AI Policy', 'Link Policy', 'Contact', 'Status'],
    'Opportunities':['ID', 'Type', 'Query', 'Page', 'Impressions', 'Position', 'CTR', 'Detail', 'Created'],
    'Topics':       ['ID', 'Title', 'Angle', 'Target Query', 'Author', 'Publication', 'Pages to Link', 'Score', 'Score Reason', 'Status'],
    'Drafts':       ['ID', 'Topic ID', 'Doc Link', 'Status', 'Source URL', 'Similarity Flag', 'Approved By', 'Approved Date'],
    'Copies':       ['Source URL', 'Angle', 'Author', 'Publication', 'Format', 'Length', 'Doc Link', 'Similarity Flag'],
    'Broken Links': ['Broken URL', 'Status Code', 'Linked From', 'In GSC?', 'Impressions', 'Suggested Replacement', 'Action']
  };

  for (var name in tabConfigs) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    var headers = tabConfigs[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  SpreadsheetApp.getUi().alert('All tabs created.');
}

// ---------- Step 1: Opportunities ----------

function findOpportunities() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var queriesSheet = ss.getSheetByName('Queries');
  var pagesSheet = ss.getSheetByName('Pages');
  var oppSheet = ss.getSheetByName('Opportunities');

  if (!queriesSheet || !pagesSheet || !oppSheet) {
    SpreadsheetApp.getUi().alert('Missing tabs. Run Setup first, then paste GSC data into Queries and Pages.');
    return;
  }

  var queries = getSheetData_(queriesSheet);
  var pages = getSheetData_(pagesSheet);
  var config = getConfig_();
  var opps = [];
  var id = 1;

  // Striking distance: position 8–20, impressions above threshold
  queries.forEach(function(row) {
    var pos = parseFloat(row['Position']);
    var imp = parseInt(row['Impressions']);
    if (pos >= 8 && pos <= 20 && imp >= config.impressionThreshold) {
      opps.push([id++, 'striking-distance', row['Query'], row['Page'] || '', imp, pos, row['CTR'] || '', 'Pos ' + pos + ', ' + imp + ' imp', new Date()]);
    }
  });

  // Low CTR pages
  var avgCtr = pages.reduce(function(sum, r) { return sum + (parseFloat(r['CTR']) || 0); }, 0) / (pages.length || 1);
  pages.forEach(function(row) {
    var ctr = parseFloat(row['CTR']);
    var imp = parseInt(row['Impressions']);
    if (imp >= config.impressionThreshold && ctr < avgCtr * 0.5) {
      opps.push([id++, 'low-ctr', '', row['Page'], imp, row['Position'] || '', ctr, 'CTR ' + (ctr * 100).toFixed(1) + '% vs avg ' + (avgCtr * 100).toFixed(1) + '%', new Date()]);
    }
  });

  if (opps.length === 0) {
    SpreadsheetApp.getUi().alert('No opportunities found. GSC data may be thin — try lowering the impression threshold in Config.');
    return;
  }

  // Clear old data (keep header) and write
  if (oppSheet.getLastRow() > 1) {
    oppSheet.getRange(2, 1, oppSheet.getLastRow() - 1, oppSheet.getLastColumn()).clear();
  }
  oppSheet.getRange(2, 1, opps.length, opps[0].length).setValues(opps);
  SpreadsheetApp.getUi().alert(opps.length + ' opportunities found.');
}

// ---------- Step 2: Internal Links ----------

function suggestInternalLinks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var oppSheet = ss.getSheetByName('Opportunities');
  var sitemapSheet = ss.getSheetByName('Sitemap');

  if (!oppSheet || !sitemapSheet) {
    SpreadsheetApp.getUi().alert('Missing Opportunities or Sitemap tab.');
    return;
  }

  var opps = getSheetData_(oppSheet);
  var pages = getSheetData_(sitemapSheet);

  if (opps.length === 0 || pages.length === 0) {
    SpreadsheetApp.getUi().alert('Run Step 1 first and make sure Sitemap has data.');
    return;
  }

  var config = getConfig_();
  var prompt = buildInternalLinksPrompt_(opps, pages);
  var result = callLLM_(prompt, config);

  // Write suggestions to a new column in Opportunities or show in a dialog
  SpreadsheetApp.getUi().alert('Internal link suggestions:\n\n' + result.substring(0, 2000));
}

// ---------- Step 3: Topics ----------

function generateTopics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var oppSheet = ss.getSheetByName('Opportunities');
  var pubSheet = ss.getSheetByName('Publications');
  var sitemapSheet = ss.getSheetByName('Sitemap');
  var topicsSheet = ss.getSheetByName('Topics');

  var opps = getSheetData_(oppSheet);
  var pubs = getSheetData_(pubSheet);
  var pages = getSheetData_(sitemapSheet);
  var config = getConfig_();

  var prompt = 'You are an SEO content strategist for Something (something.cloud), an AI agent-builder platform.\n\n'
    + 'Using ONLY the data below, propose 5 guest-post/blog topic ideas. Return JSON array with fields: title, angle, target_query, author, publication, pages_to_link, score (1-10), score_reason.\n\n'
    + 'Authors:\n- Aankit Roy (CEO): founder journey, building a startup in Bengaluru, fundraising, go-to-market\n'
    + '- Shinjan Patra (CTO): technical / AI agents, voice agents in Indian languages, MCP, architecture\n\n'
    + 'Do not invent statistics.\n\n'
    + 'Opportunities:\n' + JSON.stringify(opps.slice(0, 20)) + '\n\n'
    + 'Pages:\n' + JSON.stringify(pages.slice(0, 30)) + '\n\n'
    + 'Publications:\n' + JSON.stringify(pubs.slice(0, 20));

  var result = callLLM_(prompt, config);
  var topics = tryParseJSON_(result);

  if (!topics || !topics.length) {
    SpreadsheetApp.getUi().alert('Could not parse topics. Raw response:\n\n' + result.substring(0, 2000));
    return;
  }

  var rows = topics.map(function(t, i) {
    return [i + 1, t.title, t.angle, t.target_query, t.author, t.publication, (t.pages_to_link || []).join(', '), t.score, t.score_reason, 'Proposed'];
  });

  if (topicsSheet.getLastRow() > 1) {
    topicsSheet.getRange(2, 1, topicsSheet.getLastRow() - 1, topicsSheet.getLastColumn()).clear();
  }
  topicsSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  SpreadsheetApp.getUi().alert(rows.length + ' topics generated. Review in the Topics tab.');
}

// ---------- Step 4: Draft ----------

function draftSelectedTopic() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var topicsSheet = ss.getSheetByName('Topics');
  var draftsSheet = ss.getSheetByName('Drafts');
  var config = getConfig_();

  var row = topicsSheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('Select a topic row first.');
    return;
  }

  var data = topicsSheet.getRange(row, 1, 1, topicsSheet.getLastColumn()).getValues()[0];
  var title = data[1];
  var angle = data[2];
  var author = data[4];
  var query = data[3];
  var pages = data[6];

  var prompt = 'Write a ~1,000-word guest post draft.\n\n'
    + 'Title: ' + title + '\nAngle: ' + angle + '\nAuthor: ' + author + '\nTarget query: ' + query + '\n\n'
    + 'Rules:\n'
    + '- Include 1–2 natural links to something.cloud pages: ' + pages + '\n'
    + '- Mark any claim needing evidence as [NEEDS SOURCE]\n'
    + '- Mark where a real founder example belongs as [FOUNDER STORY]\n'
    + '- Do not invent statistics, customers, or case studies\n'
    + '- Write in a direct, conversational tone — not corporate\n\n'
    + 'Return: outline (H2s) then the full draft.';

  var result = callLLM_(prompt, config);

  // Create Google Doc
  var doc = DocumentApp.create('Draft: ' + title);
  doc.getBody().setText(result);
  var docUrl = doc.getUrl();

  // Log in Drafts tab
  var draftRow = [draftsSheet.getLastRow(), data[0], docUrl, 'Draft', '', '', '', ''];
  draftsSheet.appendRow(draftRow);

  // Update topic status
  topicsSheet.getRange(row, 10).setValue('Drafted');

  SpreadsheetApp.getUi().alert('Draft created: ' + docUrl);
}

// ---------- Step 5: Blog → Copies ----------

function blogToCopies() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var copiesSheet = ss.getSheetByName('Copies');
  var draftsSheet = ss.getSheetByName('Drafts');
  var pubSheet = ss.getSheetByName('Publications');
  var config = getConfig_();

  var row = copiesSheet.getActiveCell().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('Enter a source URL in the Copies tab row 2+ and select that row.');
    return;
  }

  var sourceUrl = copiesSheet.getRange(row, 1).getValue();
  if (!sourceUrl) {
    SpreadsheetApp.getUi().alert('No URL in the selected row.');
    return;
  }

  var numCopies = 5; // default; can read from a cell if needed

  // Fetch the source page
  var content;
  try {
    var response = UrlFetchApp.fetch(sourceUrl, { muteHttpExceptions: true, followRedirects: true });
    if (response.getResponseCode() !== 200) {
      SpreadsheetApp.getUi().alert("Couldn't read page (status " + response.getResponseCode() + "). Paste the article text into column B instead.");
      return;
    }
    content = stripHtml_(response.getContentText());
  } catch (e) {
    SpreadsheetApp.getUi().alert("Couldn't fetch the URL. Paste the article text into column B instead.");
    return;
  }

  if (content.length < 200) {
    SpreadsheetApp.getUi().alert("Page content too short — might be JS-rendered. Paste the article text into column B instead.");
    return;
  }

  var pubs = getSheetData_(pubSheet);

  // Call A: plan angles
  var planPrompt = 'From this article, create ' + numCopies + ' pieces that are clearly different from each other.\n\n'
    + 'Each must differ in: angle/main argument, examples, structure, title, author (Aankit = founder journey; Shinjan = tech/AI agents), target publication (from list), format (how-to, opinion, listicle, case study, LinkedIn post) and length.\n'
    + 'No two may share the same angle, format+author pair, or main examples.\n\n'
    + 'Publications: ' + JSON.stringify(pubs.slice(0, 15)) + '\n\n'
    + 'Article:\n' + content.substring(0, 8000) + '\n\n'
    + 'Return JSON array with fields: angle, author, publication, format, length, title.';

  var planResult = callLLM_(planPrompt, config);
  var briefs = tryParseJSON_(planResult);

  if (!briefs || !briefs.length) {
    SpreadsheetApp.getUi().alert('Could not parse angle plan. Raw:\n\n' + planResult.substring(0, 2000));
    return;
  }

  // Call B: draft each (batched to stay under 6-min limit)
  var drafts = [];
  for (var i = 0; i < briefs.length; i++) {
    var b = briefs[i];
    var draftPrompt = 'Write a ' + (b.format || 'article') + ', ~' + (b.length || '800') + ' words.\n\n'
      + 'Title: ' + b.title + '\nAngle: ' + b.angle + '\nAuthor: ' + b.author + '\n\n'
      + 'Rules:\n- Do not reuse sentences or examples from the source or other copies\n'
      + '- Mark claims needing evidence as [NEEDS SOURCE]\n- Mark where a real founder story belongs as [FOUNDER STORY]\n'
      + '- Include 1–2 natural links to something.cloud\n- Conversational tone, not corporate\n\n'
      + 'Source summary (for context only, do not copy): ' + content.substring(0, 3000);

    var draftText = callLLM_(draftPrompt, config);

    var doc = DocumentApp.create('Copy ' + (i + 1) + ': ' + b.title);
    doc.getBody().setText(draftText);

    copiesSheet.getRange(row + i, 1, 1, 8).setValues([[
      sourceUrl, b.angle, b.author, b.publication, b.format, b.length, doc.getUrl(), ''
    ]]);

    draftsSheet.appendRow([draftsSheet.getLastRow(), '', doc.getUrl(), 'Draft', sourceUrl, '', '', '']);
    drafts.push(draftText);
  }

  // Similarity check
  for (var a = 0; a < drafts.length; a++) {
    for (var b2 = a + 1; b2 < drafts.length; b2++) {
      if (similarity_(drafts[a], drafts[b2]) > 0.25) {
        copiesSheet.getRange(row + a, 8).setValue('Too similar to copy ' + (b2 + 1));
        copiesSheet.getRange(row + b2, 8).setValue('Too similar to copy ' + (a + 1));
      }
    }
  }

  SpreadsheetApp.getUi().alert(briefs.length + ' copies created. Check Copies and Drafts tabs.');
}

// ---------- Step 6: Broken Links ----------

function checkBrokenLinks() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sitemapSheet = ss.getSheetByName('Sitemap');
  var brokenSheet = ss.getSheetByName('Broken Links');
  var pagesSheet = ss.getSheetByName('Pages');

  if (!sitemapSheet) {
    SpreadsheetApp.getUi().alert('Missing Sitemap tab. Run Setup first.');
    return;
  }

  var urls = getSheetData_(sitemapSheet);
  var gscPages = pagesSheet ? getSheetData_(pagesSheet) : [];
  var gscUrls = {};
  gscPages.forEach(function(p) { gscUrls[p['Page']] = parseInt(p['Impressions']) || 0; });

  var broken = [];
  var checked = {};

  for (var i = 0; i < urls.length; i++) {
    var url = urls[i]['URL'];
    if (!url || checked[url]) continue;
    checked[url] = true;

    try {
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: false });
      var code = resp.getResponseCode();
      sitemapSheet.getRange(i + 2, 3).setValue(code);
      sitemapSheet.getRange(i + 2, 4).setValue(new Date());

      if (code === 404 || code >= 500) {
        var inGsc = gscUrls[url] !== undefined;
        broken.push([url, code, '', inGsc ? 'Yes' : 'No', inGsc ? gscUrls[url] : '', '', '']);
      }

      Utilities.sleep(200); // polite pause
    } catch (e) {
      sitemapSheet.getRange(i + 2, 3).setValue('Error');
    }
  }

  if (broken.length === 0) {
    SpreadsheetApp.getUi().alert('No broken links found.');
    return;
  }

  if (brokenSheet.getLastRow() > 1) {
    brokenSheet.getRange(2, 1, brokenSheet.getLastRow() - 1, brokenSheet.getLastColumn()).clear();
  }
  brokenSheet.getRange(2, 1, broken.length, broken[0].length).setValues(broken);
  SpreadsheetApp.getUi().alert(broken.length + ' broken URLs found. Check Broken Links tab.');
}
