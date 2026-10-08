/**
 * Guestpost Writer — Google Sheet + Apps Script
 * Menu, the pipeline map, and the six steps. Each step is a short list of stages run by runStep_ (Core.gs).
 * The tool only writes drafts and lists: it never publishes, sends a pitch or changes the site.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu(APP_NAME)
    .addItem('1. Find Opportunities', 'findOpportunities')
    .addItem('2. Suggest Internal Links', 'suggestInternalLinks')
    .addItem('3. Generate Topics', 'generateTopics')
    .addItem('4. Draft Approved Topics', 'draftApprovedTopics')
    .addSeparator()
    .addItem('5a. Blog → Plan Copy Angles', 'planCopies')
    .addItem('5b. Blog → Write Copies', 'draftCopies')
    .addItem('5c. Blog → Re-check Similarity', 'checkSimilarity')
    .addItem('6. Check Broken Links', 'checkBrokenLinks')
    .addSeparator()
    .addItem('Resume from last successful step', 'resumeLastRun')
    .addItem('Where did it break? (status)', 'showStatus')
    .addSeparator()
    .addSubMenu(ui.createMenu('Setup')
      .addItem('Create / repair tabs', 'setupTabs')
      .addItem('Set LLM API key', 'setApiKey')
      .addItem('Test LLM connection', 'testLlm')
      .addItem('Import sitemap', 'importSitemap')
      .addItem('Re-check broken links from scratch', 'resetBrokenLinkCheck')
      .addItem('Run self-test', 'runSelfTest'))
    .addToUi();
}

// ---------- Menu actions ----------

function runAndShow_(key) {
  var result = runStep_(key);
  notify_(result.label, reportText_(result));
  return result;
}

function findOpportunities()    { return runAndShow_('opportunities'); }
function suggestInternalLinks() { return runAndShow_('links'); }
function generateTopics()       { return runAndShow_('topics'); }
function draftApprovedTopics()  { return runAndShow_('drafts'); }
function planCopies()           { return runAndShow_('copyPlan'); }
function draftCopies()          { return runAndShow_('copyDrafts'); }
function checkSimilarity()      { return runAndShow_('similarity'); }
function checkBrokenLinks()     { return runAndShow_('brokenLinks'); }
function importSitemap()        { return runAndShow_('importSitemap'); }

/**
 * Go back to the last step that worked and continue from there. If something upstream of the failed
 * step is now broken, that is run first; if the blocker needs a person, say exactly what to do.
 */
function resumeLastRun() {
  var bad = lastUnfinished_();
  if (!bad) {
    notify_('Resume', 'Nothing to resume — no failed or paused runs.');
    return null;
  }
  var nodes = pipeline_(), trace = traceBack_(bad.key, true), target = bad.key, note = '';
  if (trace.firstBad) {
    if (!nodes[trace.firstBad.key].stages) {
      notify_('Resume', 'Can\'t resume "' + bad.label + '" yet.\n\n' +
        'Last good step: ' + (trace.lastGood ? trace.lastGood.label : '(none)') + '\n' +
        'First problem: ' + trace.firstBad.label + ' — ' + trace.firstBad.detail + '\n' +
        'Fix: ' + trace.firstBad.fix + '\n\nThis one needs a person. Do it, then choose Resume again.');
      return { key: bad.key, status: 'blocked', message: trace.firstBad.detail };
    }
    target = trace.firstBad.key;
    note = 'Went back to "' + nodes[target].label + '" because "' + bad.label + '" depends on it.\n\n';
  }
  var result = runStep_(target), more = target !== bad.key && result.status === 'ok';
  notify_(result.label, note + reportText_(result) + (more ? '\n\nChoose Resume again to continue with "' + bad.label + '".' : ''));
  return result;
}

function showStatus() {
  settingsCache_ = null;
  var bad = lastUnfinished_();
  var text = bad ? 'Last unfinished run (' + bad.at.slice(0, 16).replace('T', ' ') + ' UTC):\n' + reportText_(bad) : 'No failed or paused runs.';
  text += '\n\nWhole pipeline:\n' + traceText_(statusBoard_()) + '\n\nEvery stage of every run is in the "' + T.LOG + '" tab.';
  notify_('Status', text);
  return text;
}

// ---------- Setup ----------

function setupTabs() {
  settingsCache_ = null;
  Object.keys(TABS).forEach(ensureTab_);

  var have = toSet_(readTable_(T.CONFIG).map(function(r) { return String(r.key).trim(); }));
  var old = PropertiesService.getScriptProperties().getProperties();   // settings from the first version lived here
  appendRows_(T.CONFIG, SETTINGS.filter(function(s) { return !have[s[0]]; }).map(function(s) {
    return { 'key': s[0], 'value': old[s[0]] || s[1], 'what it does': s[2] };
  }));

  HIDDEN_TABS.forEach(function(name) { sheet_(name).hideSheet(); });
  var topics = sheet_(T.TOPICS), statusCol = headers_(topics).indexOf('status') + 1;
  topics.getRange(2, statusCol, 500, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(TOPIC_STATUSES, true).setAllowInvalid(true).build());

  notify_('Setup', 'Tabs are ready.\n\nNext:\n1. Setup → Set LLM API key\n2. Paste the GSC export into Queries and Pages\n' +
    '3. Paste page URLs into Sitemap (or Setup → Import sitemap)\n4. Fill in Publications\n5. Check the Config tab');
}

function setApiKey() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('LLM API key', 'Paste the key. It is saved in Script Properties, not in a cell.\nUse a key that has a spending cap.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var key = answer.getResponseText().trim();
  if (!key) return;
  PropertiesService.getScriptProperties().setProperty('LLM_API_KEY', key);
  ui.alert('Saved. Try Setup → Test LLM connection.');
}

function testLlm() {
  settingsCache_ = null;
  try {
    var reply = callLLM_('Reply with the single word: ok', { maxTokens: 20 });
    notify_('LLM connection', 'Working. ' + setting_('LLM_MODEL') + ' replied: ' + reply.trim());
  } catch (e) {
    notify_('LLM connection', 'Not working.\n\n' + e.message + (e.fix ? '\nFix: ' + e.fix : ''));
  }
}

function resetBrokenLinkCheck() {
  var rows = readTable_(T.SITEMAP);
  rows.forEach(function(r) { r['status code'] = ''; r['last checked'] = ''; r['redirects to'] = ''; });
  writeTable_(T.SITEMAP, rows);
  writeTable_(T.LINKS, []);
  writeTable_(T.BROKEN, []);
  notify_('Broken links', 'Cleared. Run "6. Check Broken Links" to check every page again.');
}

// ---------- Pipeline map ----------
//
// Every input, human gate and step, in the order work flows. `needs` must be good before a step can
// run; `soft` helps but does not block. `verify` answers "is this done?" from what is in the Sheet,
// which is what lets a failure be traced back to the last good step.

function ok_(detail) { return { ok: true, detail: detail }; }
function no_(detail, fix) { return { ok: false, detail: detail, fix: fix }; }
function isStatus_(row, status) { return norm_(row.status) === status; }
function isBlank_(v) { return v === '' || v === undefined || v === null; }

function pipeline_() {
  var menu = APP_NAME + ' → ';
  return {
    tabs: {
      label: 'Tabs set up', fix: 'Run ' + menu + 'Setup → Create / repair tabs.',
      verify: function() {
        var missing = Object.keys(TABS).filter(function(n) { return !ss_().getSheetByName(n); });
        return missing.length ? no_('missing: ' + missing.join(', ')) : ok_(Object.keys(TABS).length + ' tabs');
      }
    },
    apiKey: {
      label: 'LLM API key', fix: 'Run ' + menu + 'Setup → Set LLM API key.',
      verify: function() { return apiKey_() ? ok_('saved in Script Properties') : no_('no key saved'); }
    },
    gsc: {
      label: 'GSC export pasted', needs: ['tabs'], fix: 'Paste the Search Console export into the Queries and Pages tabs.',
      verify: function() {
        var q = readTable_(T.QUERIES).filter(function(r) { return r.query; }).length;
        var p = readTable_(T.PAGES).filter(function(r) { return r.page; }).length;
        return q + p ? ok_(q + ' queries, ' + p + ' pages') : no_('Queries and Pages are empty — steps will run in "low data" mode');
      }
    },
    sitemap: {
      label: 'Sitemap URLs', needs: ['tabs'], fix: 'Paste page URLs into the Sitemap tab, or set SITEMAP_URLS in Config and run Setup → Import sitemap.',
      verify: function() {
        var n = sitePages_().length;
        return n ? ok_(n + ' URLs') : no_('the Sitemap tab is empty');
      }
    },
    publications: {
      label: 'Publications list', needs: ['tabs'], fix: 'Fill in the Publications tab with the guest-post targets.',
      verify: function() {
        var n = readTable_(T.PUBLICATIONS).length;
        return n ? ok_(n + ' publications') : no_('the Publications tab is empty');
      }
    },
    opportunities: {
      label: '1. Find Opportunities', needs: ['tabs'], soft: ['gsc'], fix: 'Run ' + menu + '1. Find Opportunities.',
      verify: function() {
        var rows = readTable_(T.OPPS), real = rows.filter(isRealOpp_).length;
        if (!rows.length) return no_('the Opportunities tab is empty');
        return ok_(real ? real + ' opportunities' : 'low data — no opportunities in the GSC export yet');
      },
      stages: [
        { name: 'Read GSC export', run: stageReadGsc_ },
        { name: 'Find striking-distance queries', run: stageStrikingDistance_ },
        { name: 'Find low-CTR pages', run: stageLowCtr_ },
        { name: 'Write Opportunities tab', run: stageWriteOpps_ }
      ]
    },
    links: {
      label: '2. Suggest Internal Links', needs: ['opportunities', 'sitemap'], fix: 'Run ' + menu + '2. Suggest Internal Links.',
      verify: function() {
        var real = readTable_(T.OPPS).filter(isRealOpp_), todo = real.filter(function(o) { return !o['links status']; }).length;
        if (todo) return no_(todo + ' opportunities have no link suggestions yet');
        return ok_(real.length ? real.length + ' opportunities have suggestions' : 'nothing to link (low data)');
      },
      stages: [
        { name: 'Match pages by keyword', run: stageMatchLinks_ }
      ]
    },
    topics: {
      label: '3. Generate Topics', needs: ['apiKey', 'opportunities', 'publications'], soft: ['links', 'sitemap'], fix: 'Run ' + menu + '3. Generate Topics.',
      verify: function() {
        var n = readTable_(T.TOPICS).length;
        return n ? ok_(n + ' topics') : no_('the Topics tab is empty');
      },
      stages: [
        { name: 'Collect opportunities, pages and publications', run: stageTopicInputs_ },
        { name: 'Ask the LLM for topic ideas', run: stageAskTopics_ },
        { name: 'Check and write Topics tab', run: stageWriteTopics_ }
      ]
    },
    approval: {
      label: 'Founder approves a topic', needs: ['topics'],
      fix: 'A founder sets Status to "Approved" on at least one row of the Topics tab.',
      verify: function() {
        var n = readTable_(T.TOPICS).filter(function(t) { return isStatus_(t, 'approved') || isStatus_(t, 'drafted'); }).length;
        return n ? ok_(n + ' approved') : no_('no topic is marked Approved yet');
      }
    },
    drafts: {
      label: '4. Draft Approved Topics', needs: ['apiKey', 'approval'], soft: ['sitemap'], fix: 'Run ' + menu + '4. Draft Approved Topics.',
      verify: function() {
        var topics = readTable_(T.TOPICS), waiting = topics.filter(needsDraft_).length;
        var done = topics.filter(function(t) { return t['doc link']; }).length;
        if (waiting) return no_(waiting + ' approved topic(s) have no draft yet');
        return done ? ok_(done + ' draft(s) in Google Docs') : no_('no drafts yet');
      },
      stages: [
        { name: 'Write drafts', run: stageDraftTopics_ }
      ]
    },
    copyRequest: {
      label: 'Blog URL added to Copies', needs: ['tabs'],
      fix: 'In the Copies tab, put a blog URL in "Source URL" and a number from 5 to 10 in "Copies Wanted".',
      verify: function() {
        var n = readTable_(T.COPIES).filter(function(r) { return r['source url']; }).length;
        return n ? ok_(n + ' row(s)') : no_('no Source URL in the Copies tab');
      }
    },
    copyPlan: {
      label: '5a. Blog → Plan Copy Angles', needs: ['apiKey', 'copyRequest'], soft: ['publications'], fix: 'Run ' + menu + '5a. Blog → Plan Copy Angles.',
      verify: function() {
        var rows = readTable_(T.COPIES).filter(function(r) { return r['source url']; });
        var planned = rows.filter(function(r) { return isStatus_(r, 'planned') || isStatus_(r, 'drafted'); }).length;
        var paste = rows.filter(function(r) { return isStatus_(r, 'paste needed'); }).length;
        var fresh = rows.filter(function(r) { return !r.status; }).length;
        if (paste) return no_(paste + ' page(s) could not be read', 'Paste the article into the "Pasted Text" cell of each row marked "Paste needed", then run 5a again.');
        if (fresh) return no_(fresh + ' new URL(s) not planned yet');
        return planned ? ok_(planned + ' copies planned') : no_('nothing planned yet');
      },
      stages: [
        { name: 'Read articles and plan angles', run: stagePlanCopies_ }
      ]
    },
    copyDrafts: {
      label: '5b. Blog → Write Copies', needs: ['apiKey', 'copyRequest'], soft: ['copyPlan', 'sitemap'], fix: 'Run ' + menu + '5b. Blog → Write Copies.',
      verify: function() {
        var rows = readTable_(T.COPIES), waiting = rows.filter(needsCopyDraft_).length;
        var done = rows.filter(function(r) { return isStatus_(r, 'drafted'); }).length;
        if (waiting) return no_(waiting + ' planned copies have no draft yet');
        return done ? ok_(done + ' copies drafted') : no_('no copies drafted yet');
      },
      stages: [
        { name: 'Write copies', run: stageDraftCopies_ },
        { name: 'Similarity check', run: stageSimilarity_ }
      ]
    },
    similarity: {
      label: '5c. Blog → Re-check Similarity', needs: ['tabs'], soft: ['copyDrafts'], fix: 'Run ' + menu + '5c. Blog → Re-check Similarity.',
      verify: function() {
        var copies = readTable_(T.DRAFTS).filter(function(d) { return d['source url']; });
        var unflagged = copies.filter(function(d) { return !d['similarity flag']; }).length;
        if (!copies.length) return no_('no copy drafts to compare yet');
        return unflagged ? no_(unflagged + ' copy draft(s) not compared yet') : ok_(copies.length + ' copy drafts compared');
      },
      stages: [
        { name: 'Similarity check', run: stageSimilarity_ }
      ]
    },
    brokenLinks: {
      label: '6. Check Broken Links', needs: ['tabs', 'sitemap'], soft: ['gsc'], fix: 'Run ' + menu + '6. Check Broken Links.',
      verify: function() {
        var unchecked = sitePages_().filter(function(p) { return isBlank_(p.code); }).length;
        var links = readTable_(T.LINKS).filter(function(l) { return isBlank_(l['status code']); }).length;
        if (unchecked + links) return no_(unchecked + ' sitemap URL(s) and ' + links + ' link(s) not checked yet');
        return ok_(readTable_(T.BROKEN).length + ' broken URL(s) listed');
      },
      stages: [
        { name: 'Check sitemap URLs', run: stageCheckSitemap_ },
        { name: 'Check links found on those pages', run: stageCheckLinks_ },
        { name: 'Cross-check with GSC and suggest fixes', run: stageBrokenReport_ }
      ]
    },
    importSitemap: {
      label: 'Import sitemap', needs: ['tabs'],
      stages: [
        { name: 'Fetch sitemap and add new URLs', run: stageImportSitemap_ }
      ]
    }
  };
}

// ---------- Shared readers ----------

function isRealOpp_(o) { return norm_(o.type) !== 'low-data'; }
function needsDraft_(t) { return isStatus_(t, 'approved') && !t['doc link']; }
function needsCopyDraft_(r) { return isStatus_(r, 'planned') && !r['doc link']; }

function sitePages_() {
  return readTable_(T.SITEMAP).filter(function(r) { return r.url; }).map(function(r) {
    return { url: String(r.url).trim(), title: String(r.title || ''), code: r['status code'], _row: r._row };
  });
}

/** Pages we can link to: everything in the Sitemap tab that step 6 has not found broken. */
function livePages_() {
  return sitePages_().filter(function(p) { return isBlank_(p.code) || Number(p.code) === 200; });
}

/** URLs a draft may link to: the ones asked for, else MONEY_PAGES, else the closest pages by keyword. */
function linksFor_(text, preferred) {
  var out = splitList_(preferred);
  if (!out.length) out = splitList_(setting_('MONEY_PAGES'));
  if (!out.length) out = matchPages_(text, livePages_(), 3).map(function(p) { return p.url; });
  if (!out.length) out = splitList_(setting_('SITE_DOMAINS')).slice(0, 1).map(function(d) { return 'https://' + d + '/'; });
  return out.slice(0, 4);
}

function draftMeta_(author, publication, extra) {
  return 'DRAFT — not fact-checked. Author: ' + (author || '?') + ' · Publication: ' + (publication || '?') + (extra ? ' · ' + extra : '') +
    '. Fill every highlighted [NEEDS SOURCE] and [FOUNDER STORY] before review.';
}

/** One draft: LLM call, then a Google Doc. Both are cached so a retry does not pay or create twice. */
function writeDraft_(ctx, tag, prompt, title, meta) {
  var markdown = ctx.cached(tag + ': LLM draft', prompt, function() {
    return callLLM_(prompt, { system: systemPrompt_() });
  });
  return ctx.cached(tag + ': create Google Doc', 'doc|' + prompt, function() {
    return createDoc_(title, markdown, meta);
  });
}

// ---------- Step 1: Opportunities ----------

function stageReadGsc_(ctx) {
  ctx.mem.queries = readTable_(T.QUERIES).filter(function(r) { return r.query; });
  ctx.mem.pages = readTable_(T.PAGES).filter(function(r) { return r.page; });
  return ctx.mem.queries.length + ' queries and ' + ctx.mem.pages.length + ' pages read.';
}

function stageStrikingDistance_(ctx) {
  var min = settingNum_('IMPRESSION_THRESHOLD'), lo = settingNum_('POSITION_MIN'), hi = settingNum_('POSITION_MAX');
  ctx.mem.opps = ctx.mem.queries.filter(function(r) {
    var pos = toNumber_(r.position);
    return pos >= lo && pos <= hi && toNumber_(r.impressions) >= min;
  }).sort(function(a, b) {
    return toNumber_(b.impressions) - toNumber_(a.impressions);
  }).map(function(r) {
    var pos = Math.round(toNumber_(r.position) * 10) / 10, imp = toNumber_(r.impressions);
    return { 'type': 'striking-distance', 'query': r.query, 'impressions': imp, 'position': pos, 'ctr': pct_(toCtr_(r.ctr)),
             'detail': 'Position ' + pos + ', ' + imp + ' impressions' };
  });
  return ctx.mem.opps.length + ' queries at position ' + lo + '–' + hi + ' with ' + min + '+ impressions.';
}

function stageLowCtr_(ctx) {
  var pages = ctx.mem.pages, min = settingNum_('IMPRESSION_THRESHOLD'), ratio = settingNum_('LOW_CTR_RATIO');
  var clicks = 0, impressions = 0, ctrSum = 0;
  pages.forEach(function(r) { clicks += toNumber_(r.clicks); impressions += toNumber_(r.impressions); ctrSum += toCtr_(r.ctr); });
  var average = impressions && clicks ? clicks / impressions : pages.length ? ctrSum / pages.length : 0;

  var low = pages.filter(function(r) {
    return toNumber_(r.impressions) >= min && toCtr_(r.ctr) < average * ratio;
  }).sort(function(a, b) {
    return toNumber_(b.impressions) - toNumber_(a.impressions);
  }).map(function(r) {
    return { 'type': 'low-ctr', 'page': r.page, 'impressions': toNumber_(r.impressions), 'position': toNumber_(r.position) || '',
             'ctr': pct_(toCtr_(r.ctr)), 'detail': 'CTR ' + pct_(toCtr_(r.ctr)) + ' vs site average ' + pct_(average) };
  });
  ctx.mem.opps = ctx.mem.opps.concat(low);
  return low.length + ' pages with CTR under ' + pct_(average * ratio) + ' (site average ' + pct_(average) + ').';
}

function stageWriteOpps_(ctx) {
  var opps = ctx.mem.opps, found = opps.length, now = new Date();
  if (!found) {
    opps = [{ 'type': 'low-data', 'detail': 'No opportunities in the GSC export yet. Step 3 will pick topics on fit: publications, author angles and our pages.' }];
  }
  opps.forEach(function(o, i) { o.id = i + 1; o.created = now; });
  writeTable_(T.OPPS, opps);
  if (found >= settingNum_('LOW_DATA_MIN')) return found + ' opportunities written.';
  return found + ' opportunities written — LOW DATA. Step 3 still works: it will lean on publication and author fit.';
}

// ---------- Step 2: Internal links ----------

function stageMatchLinks_(ctx) {
  var rows = readTable_(T.OPPS), pages = livePages_(), linked = 0, gaps = 0;
  var byKey = {};
  pages.forEach(function(p) { byKey[urlKey_(p.url)] = p; });

  rows.filter(isRealOpp_).forEach(function(o) {
    var isPage = !!o.page && !o.query, target = '', anchor = String(o.query || ''), hits;
    if (isPage) {
      var page = byKey[urlKey_(o.page)] || { url: String(o.page), title: '' };
      target = page.url;
      anchor = cleanTitle_(page.title) || slugText_(page.url);
      hits = matchPages_(page.title + ' ' + slugText_(page.url), pages, 3, page.url);
    } else {
      hits = matchPages_(o.query, pages, 4);
      if (hits.length) target = hits.shift().url;
      hits = hits.slice(0, 3);
    }
    o['target page'] = target;
    o['link from 1'] = hits[0] ? hits[0].url : '';
    o['link from 2'] = hits[1] ? hits[1].url : '';
    o['link from 3'] = hits[2] ? hits[2].url : '';
    o['anchor'] = anchor;
    if (!target) { o['links status'] = 'No page matches this query — content gap'; gaps++; }
    else if (!hits.length) o['links status'] = 'Target found, but no other page to link from';
    else { o['links status'] = hits.length + ' page(s) to link from'; linked++; }
  });
  writeTable_(T.OPPS, rows);
  return linked + ' opportunities have pages to link from; ' + gaps + ' have no matching page (content gaps).';
}

// ---------- Step 3: Topics ----------

function stageTopicInputs_(ctx) {
  var real = readTable_(T.OPPS).filter(isRealOpp_);
  ctx.mem.lowData = real.length < settingNum_('LOW_DATA_MIN');
  ctx.mem.opps = real.slice(0, 30).map(function(o) {
    return { type: o.type, query: o.query, page: o.page, impressions: o.impressions, position: o.position, ctr: o.ctr,
             target_page: o['target page'], link_from: [o['link from 1'], o['link from 2'], o['link from 3']].filter(Boolean) };
  });
  ctx.mem.pages = livePages_().slice(0, 100).map(function(p) { return { url: p.url, title: p.title }; });
  ctx.mem.pubs = readTable_(T.PUBLICATIONS).slice(0, 40).map(function(p) { delete p._row; return p; });
  return ctx.mem.opps.length + ' opportunities, ' + ctx.mem.pages.length + ' pages and ' + ctx.mem.pubs.length + ' publications sent' +
    (ctx.mem.lowData ? ' (low data: topics chosen on fit).' : '.');
}

function stageAskTopics_(ctx) {
  var prompt = topicsPrompt_(ctx.mem);
  var answer = ctx.cached('LLM call', prompt, function() {
    return callLLMJson_(prompt, { system: systemPrompt_() });
  });
  ctx.mem.topics = listFrom_(answer, 'topics');
  if (!ctx.mem.topics.length) fail_('The LLM answered, but with no topics.', 'Run the step again.');
  return ctx.mem.topics.length + ' ideas returned.';
}

function stageWriteTopics_(ctx) {
  var known = toSet_(ctx.mem.pages.map(function(p) { return urlKey_(p.url); }));
  var pubs = toSet_(ctx.mem.pubs.map(function(p) { return norm_(p.name); }));
  var id = nextId_(T.TOPICS);
  var rows = ctx.mem.topics.filter(function(t) { return t && t.title && t.angle; }).map(function(t) {
    var links = (Array.isArray(t.pages_to_link) ? t.pages_to_link : splitList_(t.pages_to_link)).map(String);
    var kept = links.filter(function(u) { return known[urlKey_(u)]; }), notes = [];
    if (ctx.mem.lowData) notes.push('low data');
    if (kept.length < links.length) notes.push((links.length - kept.length) + ' link(s) removed: not in Sitemap');
    if (!pubs[norm_(t.publication)]) notes.push('publication not in the Publications tab');
    return { 'id': id++, 'title': t.title, 'angle': t.angle, 'target query': t.target_query || '', 'author': t.author || '',
             'publication': t.publication || '', 'pages to link': kept.join('\n'), 'score': toNumber_(t.score) || '',
             'score reason': t.score_reason || '', 'status': 'Proposed', 'why this publication': t.publication_why || '',
             'data note': notes.join('; ') };
  });
  if (!rows.length) fail_('None of the ideas had both a title and an angle.', 'Run the step again.');
  appendRows_(T.TOPICS, rows);
  return rows.length + ' topics added to the Topics tab. Next: a founder sets Status to "Approved" on the ones to write.';
}

// ---------- Step 4: Drafts ----------

function stageDraftTopics_(ctx) {
  var pending = readTable_(T.TOPICS).filter(needsDraft_), cap = settingNum_('DRAFTS_PER_RUN'), done = 0;
  pending.forEach(function(t) {
    var progress = done + ' draft(s) written, ' + (pending.length - done) + ' approved topic(s) left. Run step 4 again for the next batch.';
    if (done >= cap) pause_(progress);
    ctx.checkTime(progress);

    var tag = 'Topic ' + t.id, prompt = draftPrompt_(t, linksFor_(t.title + ' ' + t.angle, t['pages to link']));
    var doc = writeDraft_(ctx, tag, prompt, 'Draft: ' + t.title, draftMeta_(t.author, t.publication, t['target query'] ? 'Target query: ' + t['target query'] : ''));
    ctx.step(tag + ': record in Drafts and Topics', function() {
      appendRows_(T.DRAFTS, [{ 'id': nextId_(T.DRAFTS), 'topic id': t.id, 'doc link': doc.url, 'status': 'Draft', 'title': t.title,
                               'type': 'guest post', 'doc id': doc.id, 'created': new Date() }]);
      updateRow_(T.TOPICS, t._row, { 'status': 'Drafted', 'doc link': doc.url });
    });
    ctx.forget();
    done++;
  });
  if (!done) return 'No approved topics are waiting for a draft.';
  return done + ' draft(s) created — links are in the Drafts tab. Next: fact-check, add real stories, then founder review.';
}

// ---------- Step 5: Blog → copies ----------

function loadSources_() {
  var out = {};
  readTable_(T.SOURCES).forEach(function(s) { out[urlKey_(s['source url'])] = { url: s['source url'], title: s.title, text: String(s.text || ''), _row: s._row }; });
  return out;
}

/** The article behind a request row: pasted text if given, else fetched. null if it could not be read. */
function readSource_(req, sources) {
  var url = String(req['source url']).trim(), pasted = String(req['pasted text'] || '').trim(), min = settingNum_('MIN_ARTICLE_WORDS');
  var source = null, why = '';
  if (wordCount_(pasted) >= min) {
    source = { url: url, title: String(req.title || '') || pasted.split('\n')[0].slice(0, 120), text: pasted, note: 'pasted text' };
  } else if (sources[urlKey_(url)]) {
    return sources[urlKey_(url)];
  } else {
    var res = fetchPage_(url);
    if (res.code !== 200) why = 'status ' + res.code;
    else {
      var page = htmlToText_(res.html);
      if (wordCount_(page.text) >= min) source = { url: url, title: page.title, text: page.text, note: 'fetched' };
      else why = 'almost no text — the page may be built with JavaScript';
    }
  }
  if (!source) {
    updateRow_(T.COPIES, req._row, { 'status': 'Paste needed',
      'message': "Couldn't read page (" + why + '), paste the text instead: put the article in this row\'s "Pasted Text" cell and run 5a again.' });
    return null;
  }
  if (source.text.length > 45000) {
    source.text = source.text.slice(0, 45000);
    source.note += '; cut to the first 45,000 characters (a Sheet cell holds 50,000)';
  }
  var row = { 'source url': url, 'title': source.title, 'text': source.text, 'note': source.note, 'fetched': new Date() };
  if (sources[urlKey_(url)]) updateRow_(T.SOURCES, sources[urlKey_(url)]._row, row);
  else appendRows_(T.SOURCES, [row]);
  return source;
}

function stagePlanCopies_(ctx) {
  var requests = readTable_(T.COPIES).filter(function(r) { return r['source url'] && (!r.status || isStatus_(r, 'paste needed')); });
  if (!requests.length) return 'No new blog URLs. Add one in the Copies tab: "Source URL" and "Copies Wanted".';
  var pubs = readTable_(T.PUBLICATIONS).slice(0, 40).map(function(p) { delete p._row; return p; });
  var planned = 0, unread = 0;

  requests.forEach(function(req) {
    ctx.checkTime(planned + ' copies planned so far. Run 5a again to continue.');
    var tag = shortUrl_(req['source url']);
    var source = ctx.step(tag + ': read article', function() { return readSource_(req, loadSources_()); });
    if (!source) {
      ctx.info(tag, 'could not read the page — marked "Paste needed"');
      unread++;
      return;
    }
    var n = Math.min(10, Math.max(1, parseInt(req['copies wanted'], 10) || 5)), prompt = copyPlanPrompt_(source, n, pubs);
    var briefs = listFrom_(ctx.cached(tag + ': LLM plan angles', prompt, function() {
      return callLLMJson_(prompt, { system: systemPrompt_() });
    }), 'copies').filter(function(b) { return b && b.title && b.angle; }).slice(0, n);
    if (!briefs.length) fail_('The LLM returned no usable briefs for ' + tag + '.', 'Run 5a again.');

    ctx.step(tag + ': write briefs to Copies', function() { writeBriefs_(req, source, briefs); });
    ctx.forget();
    planned += briefs.length;
  });

  var said = planned + ' copies planned in the Copies tab. Edit any brief you like, then run 5b to write them.';
  if (unread) said += '\n' + unread + " page(s) couldn't be read — paste the text instead (see the Message column), then run 5a again.";
  return said;
}

function writeBriefs_(req, source, briefs) {
  var angles = {}, pairs = {};
  var rows = briefs.map(function(b) {
    var notes = [], angle = norm_(b.angle), pair = norm_(b.format) + '|' + norm_(b.author);
    if (angles[angle]) notes.push('same angle as another copy — edit before drafting');
    if (pairs[pair]) notes.push('same format + author as another copy — edit before drafting');
    angles[angle] = pairs[pair] = true;
    return { 'source url': source.url, 'angle': b.angle, 'author': b.author || '', 'publication': b.publication || '', 'format': b.format || '',
             'length': toNumber_(b.length_words) || 800, 'title': b.title, 'main examples': b.main_examples || '',
             'status': 'Planned', 'message': notes.join('; ') };
  });
  // Rows 2..n first: if this fails halfway, the request row is still open and 5a can simply run again.
  appendRows_(T.COPIES, rows.slice(1));
  var first = rows[0];
  first['copies wanted'] = rows.length;
  first['pasted text'] = req['pasted text'] ? '(saved)' : '';
  updateRow_(T.COPIES, req._row, first);
}

function stageDraftCopies_(ctx) {
  var all = readTable_(T.COPIES), pending = all.filter(needsCopyDraft_), sources = loadSources_();
  var cap = settingNum_('DRAFTS_PER_RUN'), done = 0;
  pending.forEach(function(b) {
    var progress = done + ' copies written, ' + (pending.length - done) + ' left. Run 5b again for the next batch.';
    if (done >= cap) pause_(progress);
    ctx.checkTime(progress);

    var key = urlKey_(b['source url']), source = sources[key], tag = 'Copy row ' + b._row;
    if (!source) fail_('The saved article for ' + shortUrl_(b['source url']) + ' is missing.', 'Clear the Status cell on that row and run 5a again.');
    var siblings = all.filter(function(r) { return r._row !== b._row && r.title && urlKey_(r['source url']) === key; });
    var prompt = copyDraftPrompt_(b, source, siblings, linksFor_(b.title + ' ' + b.angle, ''));
    var doc = writeDraft_(ctx, tag, prompt, 'Copy: ' + b.title, draftMeta_(b.author, b.publication, b.format));
    ctx.step(tag + ': record in Drafts and Copies', function() {
      appendRows_(T.DRAFTS, [{ 'id': nextId_(T.DRAFTS), 'doc link': doc.url, 'status': 'Draft', 'source url': b['source url'], 'title': b.title,
                               'type': 'copy', 'doc id': doc.id, 'created': new Date() }]);
      updateRow_(T.COPIES, b._row, { 'status': 'Drafted', 'doc link': doc.url });
    });
    ctx.forget();
    done++;
  });
  return done ? done + ' copies written — each has its own Google Doc.' : 'No planned copies are waiting for a draft.';
}

/** Compare every pair of copies from the same source, and each copy with the source itself. */
function stageSimilarity_(ctx) {
  var drafts = readTable_(T.DRAFTS).filter(function(d) { return d['source url'] && d['doc id']; });
  if (!drafts.length) return 'No copy drafts to compare yet.';
  var limit = settingNum_('SIMILARITY_THRESHOLD'), sources = loadSources_(), groups = {}, flagged = 0;
  drafts.forEach(function(d) {
    var key = urlKey_(d['source url']);
    (groups[key] = groups[key] || []).push(d);
  });

  Object.keys(groups).forEach(function(key) {
    var group = groups[key], source = sources[key];
    group.forEach(function(d) {
      try { d.text = docText_(d['doc id']); } catch (e) { d.unreadable = true; }
      d.close = [];
      d.top = { score: 0, name: '' };
    });
    function compare(d, text, name) {
      var score = similarity_(d.text, text);
      if (score > d.top.score) d.top = { score: score, name: name };
      if (score > limit) d.close.push(Math.round(score * 100) + '% vs ' + name);
    }
    var readable = group.filter(function(d) { return !d.unreadable; });
    readable.forEach(function(a, i) {
      if (source) compare(a, source.text, 'the source');
      readable.slice(i + 1).forEach(function(b) {
        compare(a, b.text, 'draft ' + b.id);
        compare(b, a.text, 'draft ' + a.id);
      });
    });
    group.forEach(function(d) {
      d.flag = d.unreadable ? 'Could not open the Doc'
        : d.close.length ? 'TOO CLOSE — rewrite: ' + d.close.join(', ')
        : 'OK — closest is ' + Math.round(d.top.score * 100) + '%' + (d.top.name ? ' (' + d.top.name + ')' : '');
      if (d.close.length) flagged++;
    });
  });

  var copyRows = {};
  readTable_(T.COPIES).forEach(function(c) { if (c['doc link']) copyRows[c['doc link']] = c._row; });
  drafts.forEach(function(d) {
    updateRow_(T.DRAFTS, d._row, { 'similarity flag': d.flag });
    if (copyRows[d['doc link']]) updateRow_(T.COPIES, copyRows[d['doc link']], { 'similarity flag': d.flag });
  });
  return drafts.length + ' copy drafts compared; ' + flagged + ' flagged as too close (over ' + Math.round(limit * 100) + '% shared phrases).';
}

// ---------- Step 6: Broken links ----------

function siteHosts_(pages) {
  var hosts = toSet_(splitList_(setting_('SITE_DOMAINS')).map(function(d) { return hostOf_('https://' + d.replace(/^https?:\/\//i, '')); }));
  pages.forEach(function(p) { hosts[hostOf_(p.url)] = true; });
  delete hosts[''];
  return hosts;
}

function gscImpressions_() {
  var out = {};
  readTable_(T.PAGES).forEach(function(r) { if (r.page) out[urlKey_(r.page)] = toNumber_(r.impressions); });
  return out;
}

/** _Links holds every internal link found so far: its status and the pages that link to it. */
function loadLinks_() {
  var out = {};
  readTable_(T.LINKS).forEach(function(l) {
    out[urlKey_(l.url)] = { url: String(l.url), code: l['status code'], from: splitList_(l['linked from']), checked: l['last checked'] };
  });
  return out;
}

function saveLinks_(links) {
  writeTable_(T.LINKS, Object.keys(links).map(function(k) {
    var l = links[k];
    return { 'url': l.url, 'status code': l.code, 'linked from': l.from.slice(0, 40).join('\n'), 'last checked': l.checked };
  }));
}

function addLink_(links, url, from) {
  var key = urlKey_(url), link = links[key] || (links[key] = { url: url, code: '', from: [], checked: '' });
  if (link.from.indexOf(from) === -1) link.from.push(from);
}

function stageCheckSitemap_(ctx) {
  var pages = sitePages_(), pending = pages.filter(function(p) { return isBlank_(p.code); });
  var hosts = siteHosts_(pages), links = loadLinks_(), inSitemap = toSet_(pages.map(function(p) { return urlKey_(p.url); }));
  var batch = settingNum_('FETCH_BATCH'), pauseMs = settingNum_('FETCH_PAUSE_MS');

  // Pages Google has shown but the sitemap does not list are worth checking too.
  readTable_(T.PAGES).forEach(function(r) {
    var url = String(r.page || '').trim();
    if (url && hosts[hostOf_(url)] && !inSitemap[urlKey_(url)]) addLink_(links, url, '(GSC only)');
  });

  for (var i = 0; i < pending.length; i += batch) {
    ctx.checkTime(i + ' of ' + pending.length + ' sitemap URLs checked. Run step 6 again to continue.');
    var chunk = pending.slice(i, i + batch), results = fetchMany_(chunk.map(function(p) { return p.url; }));
    chunk.forEach(function(p, j) {
      var res = results[j], patch = { 'status code': res.code, 'last checked': new Date() };
      if (res.location) patch['redirects to'] = resolveUrl_(p.url, res.location) || res.location;
      if (res.html) {
        if (!p.title) patch['title'] = titleOf_(res.html);
        extractLinks_(res.html, p.url, hosts).forEach(function(u) { addLink_(links, u, p.url); });
      }
      updateRow_(T.SITEMAP, p._row, patch);
    });
    saveLinks_(links);
    Utilities.sleep(pauseMs);
  }
  saveLinks_(links);
  return pending.length + ' sitemap URLs checked (' + (pages.length - pending.length) + ' were already done).';
}

function stageCheckLinks_(ctx) {
  var links = loadLinks_(), known = {}, batch = settingNum_('FETCH_BATCH'), pauseMs = settingNum_('FETCH_PAUSE_MS');
  sitePages_().forEach(function(p) { known[urlKey_(p.url)] = p.code; });

  // A link that points at a sitemap page was already checked in the stage above.
  Object.keys(links).forEach(function(k) {
    if (isBlank_(links[k].code) && !isBlank_(known[k])) links[k].code = known[k];
  });
  var pending = Object.keys(links).filter(function(k) { return isBlank_(links[k].code); });

  for (var i = 0; i < pending.length; i += batch) {
    ctx.checkTime(i + ' of ' + pending.length + ' links checked. Run step 6 again to continue.');
    var chunk = pending.slice(i, i + batch), results = fetchMany_(chunk.map(function(k) { return links[k].url; }));
    chunk.forEach(function(k, j) {
      links[k].code = results[j].code;
      links[k].checked = new Date();
    });
    saveLinks_(links);
    Utilities.sleep(pauseMs);
  }
  saveLinks_(links);
  return pending.length + ' more links checked, each one once (' + Object.keys(links).length + ' links found in total).';
}

function isGone_(code) { return Number(code) === 404 || Number(code) === 410; }

function stageBrokenReport_(ctx) {
  var pages = sitePages_(), links = loadLinks_(), gsc = gscImpressions_(), seen = {}, rows = [];
  var live = pages.filter(function(p) { return Number(p.code) === 200; });
  var inSitemap = toSet_(pages.map(function(p) { return urlKey_(p.url); }));

  function add(url, code, from) {
    var key = urlKey_(url);
    if (seen[key]) return;
    seen[key] = true;
    if (code !== 'ERR' && Number(code) < 400) return;
    var listed = !!inSitemap[key], impressions = gsc.hasOwnProperty(key) ? gsc[key] : null;
    var linkers = from.filter(function(f) { return f.charAt(0) !== '('; });
    var match = matchPages_(slugText_(url), live, 1, url)[0];
    rows.push({ 'broken url': url, 'status code': code, 'linked from': linkers.concat(listed ? ['(sitemap)'] : []).slice(0, 15).join('\n'),
                'in gsc?': impressions === null ? 'No' : 'Yes', 'impressions': impressions === null ? '' : impressions,
                'suggested replacement': match ? match.url : '', 'action': brokenAction_(code, linkers, listed, impressions, match) });
  }
  Object.keys(links).forEach(function(k) { add(links[k].url, links[k].code, links[k].from); });
  pages.forEach(function(p) { add(p.url, p.code, []); });

  // Fix first: gone pages that Google still shows, most impressions on top.
  rows.sort(function(a, b) {
    return (isGone_(b['status code']) - isGone_(a['status code'])) || (toNumber_(b.impressions) - toNumber_(a.impressions));
  });
  writeTable_(T.BROKEN, rows);
  var withTraffic = rows.filter(function(r) { return toNumber_(r.impressions) > 0; }).length;
  if (!rows.length) return 'No broken links found.';
  return rows.length + ' broken URL(s) listed in the Broken Links tab; ' + withTraffic + ' have Google impressions — fix those first. Nothing on the site was changed.';
}

function brokenAction_(code, linkers, listed, impressions, match) {
  if (!isGone_(code)) return 'Could not confirm (status ' + code + '). Open the URL yourself; if it really is broken, treat it like a 404.';
  var where = linkers.slice(0, 3).join(', ') + (linkers.length > 3 ? ' (+' + (linkers.length - 3) + ' more)' : ''), steps = [];
  if (impressions > 0) steps.push('Fix first — it has Google impressions. Add a 301 redirect' + (match ? ' to ' + match.url : ' to the closest live page, or restore the page'));
  if (where) steps.push(match ? 'Update the link on ' + where + ' to ' + match.url : 'Remove or replace the link on ' + where);
  if (listed) steps.push('Remove it from the sitemap');
  if (!steps.length) steps.push('No page links to it. If other sites link to it, add a 301 redirect' + (match ? ' to ' + match.url : ''));
  return steps.join('. ') + '.';
}

// ---------- Sitemap import ----------

function stageImportSitemap_(ctx) {
  var queue = splitList_(setting_('SITEMAP_URLS')), found = [], fetched = 0;
  if (!queue.length) fail_('SITEMAP_URLS is empty.', 'Put the sitemap address in the Config tab (for example https://something.cloud/sitemap.xml), then run this again.');

  while (queue.length && fetched < 25) {
    var url = queue.shift(), res = fetchRetry_(url, { muteHttpExceptions: true });
    fetched++;
    if (res.getResponseCode() !== 200) fail_('Sitemap ' + url + ' returned status ' + res.getResponseCode() + '.', 'Check SITEMAP_URLS in the Config tab.');
    var xml = res.getContentText(), locs = [], re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi, m;
    while ((m = re.exec(xml))) locs.push(decodeEntities_(m[1]));
    if (/<sitemapindex/i.test(xml)) queue = queue.concat(locs);
    else found = found.concat(locs);
  }

  var have = toSet_(sitePages_().map(function(p) { return urlKey_(p.url); })), fresh = [];
  found.forEach(function(u) {
    if (have[urlKey_(u)]) return;
    have[urlKey_(u)] = true;
    fresh.push({ 'url': u });
  });
  appendRows_(T.SITEMAP, fresh);
  return fresh.length + ' new URL(s) added to the Sitemap tab (' + found.length + ' found in ' + fetched + ' sitemap file(s)).';
}
