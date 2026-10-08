/**
 * Core — the reusable engine. Nothing in this file knows about guest posts.
 *
 *   Settings    setting_(), settingNum_(), apiKey_()
 *   Tables      readTable_(), writeTable_(), appendRows_(), updateRow_(), ensureTab_()
 *   Run engine  runStep_(): stages, Run Log, clean pause before the 6-minute limit, cache for paid calls
 *   Trace back  traceBack_(): walk upstream from a step to the last good one and the first broken one
 *   Network     fetchRetry_(), fetchMany_(), callLLM_(), callLLMJson_()
 *   Docs        createDoc_(), docText_()
 */

// ---------- Errors ----------

/** Stop the step with a message and what to do about it. */
function fail_(message, fix) {
  var e = new Error(message);
  e.fix = fix || '';
  throw e;
}

/** Stop the step cleanly with work left over. Running it again continues. */
function pause_(message) {
  var e = new Error(message);
  e.pause = true;
  throw e;
}

// ---------- Settings ----------

var settingsCache_ = null;

function setting_(key) {
  if (!settingsCache_) {
    var out = {};
    SETTINGS.forEach(function(s) { out[s[0]] = s[1]; });
    if (ss_().getSheetByName(T.CONFIG)) {
      readTable_(T.CONFIG).forEach(function(r) {
        var k = String(r.key || '').trim();
        if (out.hasOwnProperty(k) && r.value !== '' && r.value != null) out[k] = r.value;
      });
    }
    settingsCache_ = out;
  }
  return settingsCache_[key];
}

function settingNum_(key) {
  var n = parseFloat(setting_(key));
  if (!isNaN(n)) return n;
  return SETTINGS.filter(function(s) { return s[0] === key; })[0][1];
}

function apiKey_() {
  return PropertiesService.getScriptProperties().getProperty('LLM_API_KEY') || '';
}

// ---------- Tables ----------

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function norm_(header) {
  var h = String(header == null ? '' : header).trim().toLowerCase();
  return HEADER_ALIASES[h] || h;
}

function sheet_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) fail_('Missing tab "' + name + '".', 'Run ' + APP_NAME + ' → Setup → Create / repair tabs.');
  return sheet;
}

function headers_(sheet) {
  var width = sheet.getLastColumn();
  return width ? sheet.getRange(1, 1, 1, width).getValues()[0].map(norm_) : [];
}

/** Create the tab if needed and add any missing headers on the right. Never touches data. */
function ensureTab_(name) {
  var sheet = ss_().getSheetByName(name) || ss_().insertSheet(name);
  var have = headers_(sheet);
  var missing = TABS[name].filter(function(h) { return have.indexOf(norm_(h)) === -1; });
  if (missing.length) {
    sheet.getRange(1, have.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Rows as objects keyed by lower-case header, plus _row (the Sheet row number). Blank rows are skipped. */
function readTable_(name) {
  var sheet = sheet_(name), last = sheet.getLastRow(), keys = headers_(sheet), rows = [];
  if (last < 2 || !keys.length) return rows;
  sheet.getRange(2, 1, last - 1, keys.length).getValues().forEach(function(values, i) {
    if (values.join('') === '') return;
    var row = { _row: i + 2 };
    keys.forEach(function(k, c) { if (k) row[k] = values[c]; });
    rows.push(row);
  });
  return rows;
}

// Text from the web or the LLM that starts like a formula would be run by Sheets; store it as plain text.
function safeCell_(v) {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' && /^[=+\-@]/.test(v) && isNaN(Number(v)) ? "'" + v : v;
}

function toValues_(sheet, rows) {
  var keys = headers_(sheet);
  return rows.map(function(row) {
    return keys.map(function(k) { return safeCell_(row[k]); });
  });
}

function makeRoom_(sheet, lastRowNeeded) {
  var extra = lastRowNeeded - sheet.getMaxRows();
  if (extra > 0) sheet.insertRowsAfter(sheet.getMaxRows(), extra);
}

/** Replace everything under the header row. */
function writeTable_(name, rows) {
  var sheet = sheet_(name), last = sheet.getLastRow(), width = sheet.getLastColumn();
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (!rows.length) return;
  makeRoom_(sheet, rows.length + 1);
  sheet.getRange(2, 1, rows.length, width).setValues(toValues_(sheet, rows));
}

function appendRows_(name, rows) {
  if (!rows.length) return;
  var sheet = sheet_(name), first = sheet.getLastRow() + 1;
  makeRoom_(sheet, first + rows.length - 1);
  sheet.getRange(first, 1, rows.length, sheet.getLastColumn()).setValues(toValues_(sheet, rows));
}

/** Change a few cells of one row, e.g. updateRow_(T.TOPICS, row._row, { status: 'Drafted' }). */
function updateRow_(name, rowNumber, patch) {
  var sheet = sheet_(name), keys = headers_(sheet);
  Object.keys(patch).forEach(function(k) {
    var col = keys.indexOf(k);
    if (col !== -1) sheet.getRange(rowNumber, col + 1).setValue(safeCell_(patch[k]));
  });
}

function nextId_(name) {
  return readTable_(name).reduce(function(max, r) { return Math.max(max, parseInt(r.id, 10) || 0); }, 0) + 1;
}

function notify_(title, text) {
  try {
    var ui = SpreadsheetApp.getUi();
    ui.alert(title, text, ui.ButtonSet.OK);
  } catch (e) {
    Logger.log(title + '\n' + text);
  }
}

// ---------- Run engine ----------
//
// A step is a list of stages. runStep_ runs them in order and writes one Run Log row per stage, so
// after a failure the log shows the last stage that worked and the one that broke.
//
// Resuming is running the step again. That is safe because:
//   - cheap stages (read, filter, match) simply run again;
//   - batch stages mark each row when it is done, so finished rows are skipped;
//   - paid or slow calls go through ctx.cached(), so a result that was already paid for is reused.

function runStep_(key) {
  var node = pipeline_()[key], lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) {
    return { key: key, label: node.label, status: 'busy', message: 'Another run is still going. Wait for it to finish, then try again.' };
  }
  settingsCache_ = null;
  var run = { key: key, label: node.label, id: 'r' + Utilities.getUuid().slice(0, 7), started: Date.now(), stack: [], lastOk: '', notes: [], cacheKeys: [] };
  var ctx = makeCtx_(run), result, props = PropertiesService.getDocumentProperties();
  props.setProperty('gpw.state.' + key, JSON.stringify({ key: key, label: node.label, runId: run.id, at: new Date().toISOString(), status: 'interrupted',
    message: "The run stopped before it finished — most likely Google's 6-minute limit, or the tab was closed." }));
  try {
    logRun_(run, '', 'START', '');
    try {
      ctx.step('Pre-flight check', function() {
        var trace = traceBack_(key, true);
        if (!trace.firstBad) return;
        var e = new Error(trace.firstBad.label + ' — ' + trace.firstBad.detail);
        e.fix = trace.firstBad.fix;
        e.blocked = true;
        throw e;
      });
      node.stages.forEach(function(stage) {
        var said = ctx.step(stage.name, function() { return stage.run(ctx); }, true);
        if (said) run.notes.push(said);
      });
      ctx.forget();
      result = { status: 'ok', message: run.notes.join('\n') };
    } catch (e) {
      if (e.pause) result = { status: 'paused', message: run.notes.concat(e.message).join('\n') };
      else result = { status: e.blocked ? 'blocked' : 'failed', message: e.message, fix: e.fix || '', failedAt: e.at || '', lastOk: run.lastOk };
    }
    result.key = key;
    result.label = node.label;
    result.runId = run.id;
    result.at = new Date().toISOString();
    result.message = String(result.message).slice(0, 2000);
    props.setProperty('gpw.state.' + key, JSON.stringify(result));
    logRun_(run, '', result.status === 'ok' ? 'DONE' : result.status.toUpperCase(), result.message);
  } finally {
    lock.releaseLock();
  }
  return result;
}

function makeCtx_(run) {
  var cache = CacheService.getDocumentCache();
  var ctx = {
    // Scratch space for passing data between the stages of one run.
    mem: {},

    // Run fn as a named sub-step. Logged as OK or FAIL, so the Run Log can point at the exact break.
    step: function(label, fn, isStage) {
      run.stack.push(label);
      var path = run.stack.join(' › '), t0 = Date.now();
      try {
        var out = fn();
        logRun_(run, path, 'OK', isStage && typeof out === 'string' ? out : '', Date.now() - t0);
        run.lastOk = path;
        return out;
      } catch (e) {
        if (!e.at) {
          e.at = path;
          logRun_(run, path, e.pause ? 'PAUSED' : 'FAIL', e.message, Date.now() - t0);
        }
        throw e;
      } finally {
        run.stack.pop();
      }
    },

    // Like step(), for calls that cost money or create something (LLM calls, new Docs). The result is
    // kept for 6 hours under a key built from `seed`, so a re-run after a failure reuses it.
    cached: function(label, seed, fn) {
      var cacheKey = 'gpw:' + hash_(seed), hit = cache.get(cacheKey);
      run.cacheKeys.push(cacheKey);
      if (hit !== null) {
        logRun_(run, run.stack.concat(label).join(' › '), 'CACHED', 'reused from the earlier run');
        return JSON.parse(hit);
      }
      var out = ctx.step(label, fn);
      try { cache.put(cacheKey, JSON.stringify(out), 21600); } catch (e) { /* over 100 KB: not cached */ }
      return out;
    },

    // Call when an item is completely finished, so the same input gives fresh output next time.
    forget: function() {
      run.cacheKeys.forEach(function(k) { cache.remove(k); });
      run.cacheKeys = [];
    },

    info: function(label, detail) {
      logRun_(run, run.stack.concat(label).join(' › '), 'INFO', detail);
    },

    // Call between items in a long loop. Pauses the step when the time budget is used up.
    checkTime: function(progress) {
      if (Date.now() - run.started > RUN_BUDGET_MS) {
        pause_("Stopped early to stay inside Google's 6-minute limit. " + progress);
      }
    }
  };
  return ctx;
}

function logRun_(run, path, status, detail, ms) {
  try {
    if (!ss_().getSheetByName(T.LOG)) return;
    appendRows_(T.LOG, [{ 'time': new Date(), 'run id': run.id, 'step': run.label, 'stage': path, 'status': status,
                          'detail': String(detail || '').slice(0, 500), 'ms': ms === undefined ? '' : ms }]);
  } catch (e) {
    Logger.log('Run Log write failed: ' + e.message);
  }
}

function hash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text), Utilities.Charset.UTF_8)
    .map(function(b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); })
    .join('');
}

/** The last stage a run logged as OK. Used when a run was cut off and could not record it itself. */
function lastOkInLog_(runId) {
  try {
    var ok = readTable_(T.LOG).filter(function(r) { return String(r['run id']) === runId && r.status === 'OK'; });
    return ok.length ? String(ok[ok.length - 1].stage) : '';
  } catch (e) {
    return '';
  }
}

/** The most recent run of each step, newest first. */
function loadStates_() {
  var props = PropertiesService.getDocumentProperties().getProperties(), out = [];
  Object.keys(props).forEach(function(k) {
    if (k.indexOf('gpw.state.') !== 0) return;
    try { out.push(JSON.parse(props[k])); } catch (e) { /* ignore a damaged entry */ }
  });
  return out.sort(function(a, b) { return a.at < b.at ? 1 : -1; });
}

function lastUnfinished_() {
  return loadStates_().filter(function(s) { return s.status !== 'ok'; })[0] || null;
}

// ---------- Trace back ----------
//
// pipeline_() (in Code.gs) describes every input, human gate and step as a node:
//   { label, fix, needs: [keys that must be good], soft: [keys that help but do not block],
//     verify: function → { ok, detail, fix? }, stages: [...] (steps only) }
//
// traceBack_ walks upstream from one node and checks each ancestor in dependency order. The last one
// that passes is the last good step; the first required one that fails is where the problem starts.

function check_(node) {
  try {
    return node.verify();
  } catch (e) {
    return { ok: false, detail: e.message, fix: e.fix };
  }
}

function traceBack_(key, upstreamOnly) {
  var nodes = pipeline_(), order = [], seen = {}, required = {};
  (function need(k) {
    if (required[k]) return;
    required[k] = true;
    (nodes[k].needs || []).forEach(need);
  })(key);
  (function visit(k) {
    if (seen[k]) return;
    seen[k] = true;
    (nodes[k].needs || []).concat(nodes[k].soft || []).forEach(visit);
    order.push(k);
  })(key);
  if (upstreamOnly || !nodes[key].verify) order.pop();

  var out = { lines: [], lastGood: null, firstBad: null };
  order.forEach(function(k) {
    var line = { key: k, label: nodes[k].label, fix: nodes[k].fix || '' };
    if (out.firstBad) {
      line.state = 'skip';
      line.detail = 'not checked yet';
    } else {
      var r = check_(nodes[k]);
      line.detail = r.detail;
      if (r.fix) line.fix = r.fix;
      line.state = r.ok ? 'ok' : required[k] ? 'bad' : 'warn';
      if (line.state === 'ok') out.lastGood = line;
      if (line.state === 'bad') out.firstBad = line;
    }
    out.lines.push(line);
  });
  return out;
}

/** Every node checked on its own: the whole-pipeline view. */
function statusBoard_() {
  var nodes = pipeline_();
  return Object.keys(nodes).filter(function(k) { return nodes[k].verify; }).map(function(k) {
    var r = check_(nodes[k]);
    return { key: k, label: nodes[k].label, state: r.ok ? 'ok' : 'bad', detail: r.detail, fix: r.fix || nodes[k].fix || '' };
  });
}

function traceText_(lines) {
  var icon = { ok: '✓', bad: '✗', warn: '⚠', skip: '·' };
  return lines.map(function(l) {
    return icon[l.state] + ' ' + l.label + ' — ' + l.detail + (l.state === 'bad' && l.fix ? '\n     Fix: ' + l.fix : '');
  }).join('\n');
}

function reportText_(result) {
  var label = result.label;
  if (result.status === 'ok') return '✓ ' + label + ' — done\n\n' + result.message;
  if (result.status === 'busy') return result.message;
  if (result.status === 'paused') {
    return '⏸ ' + label + ' — paused\n\n' + result.message + '\n\nNothing is lost. Choose the same menu item, or "Resume from last successful step", to continue.';
  }
  if (result.status === 'interrupted') {
    return '✗ ' + label + ' — stopped before it finished\n\n' + result.message +
      '\nLast successful step: ' + (lastOkInLog_(result.runId) || '(none)') +
      '\n\nChoose "Resume from last successful step". Work already done is kept.';
  }
  var trace = traceBack_(result.key, false), lines = [];
  if (result.status === 'blocked') {
    lines.push('✗ ' + label + " — can't run yet", '', 'What is missing: ' + result.message);
  } else {
    lines.push('✗ ' + label + ' — failed', '', 'Failed at: ' + (result.failedAt || '(start)'),
               'Last successful step: ' + (result.lastOk || '(none)'), 'Error: ' + result.message);
  }
  if (result.fix) lines.push('Fix: ' + result.fix);
  lines.push('', 'Trace back from this step:', traceText_(trace.lines), '',
             'After fixing it, choose "Resume from last successful step". Work already done is kept.');
  return lines.join('\n');
}

// ---------- Network ----------

/** Fetch with retries on network errors and on 429 / 5xx. Returns the last response. */
function fetchRetry_(url, options, tries) {
  tries = tries || 3;
  for (var attempt = 1; ; attempt++) {
    try {
      var res = UrlFetchApp.fetch(url, options);
      if (attempt >= tries || [429, 500, 502, 503, 504].indexOf(res.getResponseCode()) === -1) return res;
    } catch (e) {
      if (attempt >= tries) fail_('Could not reach ' + hostOf_(url) + ': ' + e.message, 'Check the address and try again in a minute.');
    }
    Utilities.sleep(2000 * attempt);
  }
}

function header_(res, name) {
  var headers = res.getHeaders() || {}, keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name) return String(headers[keys[i]]);
  return '';
}

function toResult_(res) {
  var code = res.getResponseCode(), type = header_(res, 'content-type');
  return {
    code: code,
    location: header_(res, 'location'),
    html: code === 200 && (!type || /html/i.test(type)) ? res.getContentText() : ''
  };
}

var CHECK_OPTIONS_ = { muteHttpExceptions: true, followRedirects: false };

/** One status check. A URL that cannot be reached at all comes back as code 'ERR' instead of throwing. */
function fetchOne_(url) {
  try {
    return toResult_(UrlFetchApp.fetch(url, CHECK_OPTIONS_));
  } catch (e) {
    return { code: 'ERR', location: '', html: '', error: e.message };
  }
}

/** Read a page the way a browser would: redirects are followed. Unreachable comes back as code 'ERR'. */
function fetchPage_(url) {
  try {
    return toResult_(UrlFetchApp.fetch(url, { muteHttpExceptions: true }));
  } catch (e) {
    return { code: 'ERR', location: '', html: '', error: e.message };
  }
}

/** Status checks in parallel. fetchAll fails as a whole if one URL is unreachable, so fall back to one by one. */
function fetchMany_(urls) {
  try {
    return UrlFetchApp.fetchAll(urls.map(function(u) {
      return { url: u, muteHttpExceptions: true, followRedirects: false };
    })).map(toResult_);
  } catch (e) {
    return urls.map(fetchOne_);
  }
}

// ---------- LLM ----------

/** One chat-completions call. opts: { system, json, maxTokens }. Returns the text. */
function callLLM_(prompt, opts) {
  opts = opts || {};
  var key = apiKey_();
  if (!key) fail_('No LLM API key saved.', APP_NAME + ' → Setup → Set LLM API key.');

  var payload = {
    model: setting_('LLM_MODEL'),
    messages: [{ role: 'user', content: prompt }],
    temperature: settingNum_('LLM_TEMPERATURE'),
    max_tokens: opts.maxTokens || settingNum_('LLM_MAX_TOKENS')
  };
  if (opts.system) payload.messages.unshift({ role: 'system', content: opts.system });
  if (opts.json && String(setting_('LLM_JSON_MODE')).toLowerCase() === 'true') payload.response_format = { type: 'json_object' };

  var res = fetchRetry_(setting_('LLM_ENDPOINT'), {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  }, 2);

  var code = res.getResponseCode(), text = res.getContentText(), json = tryParseJSON_(text);
  if (code !== 200) {
    var message = json && json.error && json.error.message ? json.error.message : text.slice(0, 300);
    fail_('LLM error ' + code + ': ' + message, llmFix_(code));
  }
  var choice = json && json.choices && json.choices[0];
  if (!choice || !choice.message || !choice.message.content) fail_('The LLM returned no text.', 'Run the step again.');
  if (choice.finish_reason === 'length') fail_('The LLM ran out of room and the text was cut off.', 'Raise LLM_MAX_TOKENS in the Config tab, then resume.');
  return choice.message.content;
}

function llmFix_(code) {
  if (code === 401 || code === 403) return 'The API key was rejected. ' + APP_NAME + ' → Setup → Set LLM API key.';
  if (code === 404) return 'Check LLM_MODEL and LLM_ENDPOINT in the Config tab.';
  if (code === 429) return 'Rate limit or spending cap reached. Check your usage with the provider, wait a minute, then resume.';
  if (code >= 500) return 'The provider is having trouble. Wait a few minutes, then resume.';
  return 'Check LLM_MODEL, LLM_ENDPOINT and LLM_MAX_TOKENS in the Config tab.';
}

/** A call that must answer in JSON. Retries once if the answer does not parse. */
function callLLMJson_(prompt, opts) {
  opts = opts || {};
  var raw = callLLM_(prompt, { system: opts.system, maxTokens: opts.maxTokens, json: true }), parsed = tryParseJSON_(raw);
  if (parsed === null) {
    raw = callLLM_(prompt + '\n\nReturn only valid JSON. No prose, no code fences.', { system: opts.system, maxTokens: opts.maxTokens, json: true });
    parsed = tryParseJSON_(raw);
  }
  if (parsed === null) fail_('The LLM did not return valid JSON. It began: ' + raw.slice(0, 200), 'Run the step again. If it keeps happening, try another LLM_MODEL.');
  return parsed;
}

/** The array inside a JSON answer: the answer itself, answer[field], or the first array found. */
function listFrom_(parsed, field) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed[field])) return parsed[field];
  var keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
  for (var i = 0; i < keys.length; i++) if (Array.isArray(parsed[keys[i]])) return parsed[keys[i]];
  return [];
}

// ---------- Docs ----------

/** New Google Doc from simple Markdown: headings, lists, **bold**, [links](url), --- rules. */
function createDoc_(title, markdown, meta) {
  var doc = DocumentApp.create(title), body = doc.getBody(), H = DocumentApp.ParagraphHeading;
  var headings = [H.HEADING1, H.HEADING2, H.HEADING3, H.HEADING4, H.HEADING5, H.HEADING6];
  var first = body.getChild(0).asParagraph();
  first.setText(title);
  first.setHeading(H.TITLE);
  if (meta) body.appendParagraph(meta).editAsText().setItalic(true);

  var lastItem = null;
  String(markdown).replace(/\r/g, '').split('\n').forEach(function(line) {
    var text = line.trim(), m, part;
    if (!text) return;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
      body.appendHorizontalRule();
      lastItem = null;
    } else if ((m = text.match(/^(#{1,6})\s+(.*)$/))) {
      part = inline_(m[2]);
      mark_(body.appendParagraph(part.text), part).setHeading(headings[m[1].length - 1]);
      lastItem = null;
    } else if ((m = text.match(/^([-*•]|\d+[.)])\s+(.*)$/))) {
      var numbered = /\d/.test(m[1]);
      part = inline_(m[2]);
      var item = mark_(body.appendListItem(part.text), part);
      if (lastItem && lastItem.numbered === numbered) item.setListId(lastItem.item);
      item.setGlyphType(numbered ? DocumentApp.GlyphType.NUMBER : DocumentApp.GlyphType.BULLET);
      lastItem = { item: item, numbered: numbered };
    } else {
      part = inline_(text.replace(/^>\s?/, ''));
      mark_(body.appendParagraph(part.text), part);
      lastItem = null;
    }
  });
  var made = { id: doc.getId(), url: doc.getUrl() };
  doc.saveAndClose();
  return made;
}

/** Markdown inline marks → plain text plus the character ranges to style. */
function inline_(source) {
  var text = '', marks = [], last = 0, m;
  var re = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  while ((m = re.exec(source))) {
    text += source.slice(last, m.index);
    var inner = m[1] !== undefined ? m[1] : m[2];
    marks.push({ start: text.length, end: text.length + inner.length - 1, bold: m[1] !== undefined, url: m[3] || '' });
    text += inner;
    last = re.lastIndex;
  }
  text += source.slice(last);
  var tag = new RegExp('\\[(' + HIGHLIGHT_TAGS.join('|') + ')[^\\]]*\\]', 'g');
  while ((m = tag.exec(text))) marks.push({ start: m.index, end: m.index + m[0].length - 1, highlight: true });
  return { text: text, marks: marks };
}

function mark_(element, part) {
  var text = element.editAsText();
  part.marks.forEach(function(k) {
    if (k.bold) text.setBold(k.start, k.end, true);
    if (k.url) text.setLinkUrl(k.start, k.end, k.url);
    if (k.highlight) text.setBackgroundColor(k.start, k.end, '#fff2cc');
  });
  return element;
}

function docText_(docId) {
  return DocumentApp.openById(docId).getBody().getText();
}
