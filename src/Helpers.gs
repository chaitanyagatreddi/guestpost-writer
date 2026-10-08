/**
 * Helpers — pure text, number and URL utilities. No Sheet, network or LLM access, so every function
 * here can be tested on its own (see Tests.gs).
 */

// ---------- Numbers ----------

function toNumber_(v) {
  if (typeof v === 'number') return v;
  return parseFloat(String(v == null ? '' : v).replace(/[,%\s]/g, '')) || 0;
}

/** CTR as a fraction. Accepts 0.032, "3.2%" and 3.2. */
function toCtr_(v) {
  var n = toNumber_(v);
  if (typeof v === 'string' && v.indexOf('%') !== -1) return n / 100;
  return n > 1 ? n / 100 : n;
}

function pct_(fraction) {
  return (fraction * 100).toFixed(1) + '%';
}

function toSet_(list) {
  var set = {};
  list.forEach(function(x) { set[x] = true; });
  return set;
}

function splitList_(v) {
  return String(v == null ? '' : v).split(/[\n,]+/).map(function(s) { return s.trim(); }).filter(Boolean);
}

function wordCount_(text) {
  return (String(text || '').match(/[\p{L}\p{N}']+/gu) || []).length;
}

// ---------- Keyword matching ----------

var STOPWORDS = toSet_(('a an and are as at be best by can do does for from get how i in is it my of on or our ' +
  'so that the their this to vs what when which who why with you your into than then them about').split(' '));

/** Lower-case keywords without stopwords or duplicates. Plurals are trimmed so "agents" matches "agent". */
function tokens_(text) {
  var seen = {}, out = [];
  String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).forEach(function(w) {
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    if (w.length < 2 || STOPWORDS[w] || seen[w]) return;
    seen[w] = true;
    out.push(w);
  });
  return out;
}

/** The words in a URL's path: https://x.com/blog/voice-agents → "blog voice agents". */
function slugText_(url) {
  var m = String(url || '').match(/^(?:https?:)?\/\/[^\/?#]+([^?#]*)/i), path = m ? m[1] : String(url || '');
  try { path = decodeURIComponent(path); } catch (e) { /* keep the raw path */ }
  return path.replace(/\.(html?|php|aspx?)$/i, '').replace(/[\/\-_.+]+/g, ' ').trim();
}

/** "Voice agents in Hindi | Something" → "Voice agents in Hindi". */
function cleanTitle_(title) {
  return String(title || '').split(/\s+[|–—]\s+|\s+-\s+/)[0].trim();
}

/**
 * The n pages whose title or URL share the most keywords with `text`, best first.
 * pages: [{ url, title }]. excludeUrl leaves one page out (a page should not link to itself).
 */
function matchPages_(text, pages, n, excludeUrl) {
  var want = tokens_(text), skip = excludeUrl ? urlKey_(excludeUrl) : '', scored = [];
  if (!want.length) return scored;
  pages.forEach(function(p) {
    if (skip && urlKey_(p.url) === skip) return;
    var have = toSet_(tokens_((p.title || '') + ' ' + slugText_(p.url)));
    var shared = want.filter(function(w) { return have[w]; }).length;
    if (shared) scored.push({ url: p.url, title: p.title || '', score: shared / want.length });
  });
  scored.sort(function(a, b) { return b.score - a.score || a.url.length - b.url.length; });
  return scored.slice(0, n);
}

// ---------- Similarity ----------

function shingles_(text, size) {
  var words = String(text || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ').match(/[\p{L}\p{N}']+/gu) || [], set = {}, count = 0;
  for (var i = 0; i + size <= words.length; i++) {
    var phrase = words.slice(i, i + size).join(' ');
    if (!set[phrase]) { set[phrase] = true; count++; }
  }
  return { set: set, count: count };
}

/**
 * Share of 3-word phrases the shorter text has in common with the other, 0 to 1.
 * Bracketed tags such as [NEEDS SOURCE] are ignored so they do not inflate the score.
 */
function similarity_(a, b) {
  var x = shingles_(a, 3), y = shingles_(b, 3), small = x.count <= y.count ? x : y, big = small === x ? y : x;
  if (!small.count) return 0;
  var shared = Object.keys(small.set).filter(function(p) { return big.set[p]; }).length;
  return shared / small.count;
}

// ---------- HTML ----------

function decodeEntities_(text) {
  var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function(all, code) {
    if (code.charAt(0) !== '#') return named.hasOwnProperty(code.toLowerCase()) ? named[code.toLowerCase()] : all;
    var n = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
}

function titleOf_(html) {
  var m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities_(m[1]).replace(/\s+/g, ' ').trim() : '';
}

/** A page's title and readable text: headings as "## ", list items as "- ", one paragraph per line. */
function htmlToText_(html) {
  var body = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|script|style|noscript|svg|template|nav|footer|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ');
  var main = body.match(/<article\b[\s\S]*<\/article>/i) || body.match(/<main\b[\s\S]*<\/main>/i) || body.match(/<body\b[\s\S]*<\/body>/i);
  if (main) body = main[0];
  var text = body
    .replace(/<h[1-6]\b[^>]*>/gi, '\n\n## ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/blockquote|\/section)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities_(text).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: titleOf_(html), text: text };
}

/** Unique absolute URLs of the <a href> links on a page that point at one of our hosts. */
function extractLinks_(html, baseUrl, hosts) {
  var re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, seen = {}, out = [], m;
  while ((m = re.exec(String(html || '')))) {
    var url = resolveUrl_(baseUrl, decodeEntities_(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]));
    if (!url || !hosts[hostOf_(url)] || seen[url]) continue;
    seen[url] = true;
    out.push(url);
  }
  return out;
}

// ---------- URLs ----------

/** Host without "www.", lower-case. */
function hostOf_(url) {
  var m = String(url || '').trim().match(/^(?:https?:)?\/\/([^\/?#]+)/i);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/** A key for comparing URLs: ignores http/https, "www.", a trailing slash and #fragments. */
function urlKey_(url) {
  var m = String(url || '').trim().match(/^(?:https?:)?\/\/([^\/?#]+)([^?#]*)(\?[^#]*)?/i);
  if (!m) return String(url || '').trim().toLowerCase();
  return m[1].toLowerCase().replace(/^www\./, '') + m[2].replace(/\/+$/, '') + (m[3] || '');
}

function shortUrl_(url) {
  var key = urlKey_(url);
  return key.length > 50 ? key.slice(0, 47) + '…' : key;
}

function normalizePath_(path) {
  var out = [];
  path.split('/').forEach(function(seg, i, all) {
    if (seg === '..') { if (out.length > 1) out.pop(); if (i === all.length - 1) out.push(''); }
    else if (seg === '.') { if (i === all.length - 1) out.push(''); }
    else out.push(seg);
  });
  return out.join('/') || '/';
}

/** Absolute URL for an href found on the page at `base`. '' for mailto:, tel:, #anchors and the like. */
function resolveUrl_(base, href) {
  href = String(href || '').trim().replace(/#.*$/, '');
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (/^[a-z][a-z0-9+.\-]*:/i.test(href)) return '';
  var m = String(base || '').match(/^(https?:)\/\/([^\/?#]+)([^?#]*)/i);
  if (!m) return '';
  var origin = m[1] + '//' + m[2], path = m[3] || '/';
  if (href.indexOf('//') === 0) return m[1] + href;
  if (href.charAt(0) === '?') return origin + path + href;
  var q = href.indexOf('?'), query = q === -1 ? '' : href.slice(q), rel = q === -1 ? href : href.slice(0, q);
  var full = rel.charAt(0) === '/' ? rel : path.replace(/[^\/]*$/, '') + rel;
  return origin + normalizePath_(full) + query;
}

// ---------- JSON ----------

/** Parse JSON even when it is wrapped in a code fence or has prose around it. null if it cannot be parsed. */
function tryParseJSON_(text) {
  text = String(text == null ? '' : text).trim();
  var fence = text.match(/```(?:json)?\s*([\s\S]*?)```/), tries = [text];
  if (fence) tries.push(fence[1].trim());
  var start = text.search(/[\[{]/), end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start !== -1 && end > start) tries.push(text.slice(start, end + 1));
  for (var i = 0; i < tries.length; i++) {
    try {
      var value = JSON.parse(tries[i]);
      if (value !== null && typeof value === 'object') return value;
    } catch (e) { /* try the next form */ }
  }
  return null;
}
