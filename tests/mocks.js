/**
 * In-memory stand-ins for the Apps Script services the tool uses, so src/*.gs can run under Node.
 * Only the methods the code calls are implemented. Ranges are bounds-checked the way Sheets does it.
 */
const crypto = require('crypto');

function makeSheet(name) {
  const data = [];
  const put = (r, c, v) => {
    while (data.length < r) data.push([]);
    while (data[r - 1].length < c) data[r - 1].push('');
    data[r - 1][c - 1] = typeof v === 'string' && v.charAt(0) === "'" ? v.slice(1) : v;   // Sheets drops the text marker
  };
  const get = (r, c) => (data[r - 1] && data[r - 1][c - 1] !== undefined ? data[r - 1][c - 1] : '');
  return {
    _data: data,
    hidden: false,
    getName: () => name,
    getLastRow: () => { for (let r = data.length; r >= 1; r--) if (data[r - 1].some(v => v !== '')) return r; return 0; },
    getLastColumn: () => data.reduce((max, row) => Math.max(max, row.reduce((m, v, i) => (v !== '' ? i + 1 : m), 0)), 0),
    getMaxRows: () => 1000,
    insertRowsAfter: () => {},
    setFrozenRows: () => {},
    hideSheet() { this.hidden = true; },
    getRange(r, c, nr = 1, nc = 1) {
      if (!(r >= 1 && c >= 1 && nr >= 1 && nc >= 1)) throw new Error(`Bad range on ${name}: ${r},${c},${nr},${nc}`);
      const range = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => get(r + i, c + j))),
        getValue: () => get(r, c),
        setValues(values) {
          if (values.length !== nr || values.some(row => row.length !== nc)) throw new Error(`setValues size mismatch on ${name}`);
          values.forEach((row, i) => row.forEach((v, j) => put(r + i, c + j, v)));
          return range;
        },
        setValue(v) { put(r, c, v); return range; },
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (get(r + i, c + j) !== '') put(r + i, c + j, ''); return range; },
        setFontWeight: () => range,
        setDataValidation: () => range
      };
      return range;
    }
  };
}

function makeProps() {
  const store = {};
  return {
    getProperty: k => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = String(v); },
    deleteProperty: k => { delete store[k]; },
    getProperties: () => Object.assign({}, store)
  };
}

function makeDoc(id, title, world) {
  const paras = [];
  const para = text => {
    const p = { text, heading: null, marks: [], list: false };
    const check = (s, e) => { if (!(s >= 0 && e >= s && e < p.text.length)) throw new Error(`Style range ${s}-${e} is outside "${p.text}"`); };
    const api = {
      _p: p,
      setText(t) { p.text = t; },   // returns nothing, as in Apps Script
      setHeading(h) { p.heading = h; return api; },
      setListId() { return api; },
      setGlyphType(g) { p.list = g; return api; },
      asParagraph: () => api,
      editAsText: () => ({
        setItalic() { p.marks.push({ italic: true }); },
        setBold(s, e) { check(s, e); p.marks.push({ bold: p.text.slice(s, e + 1) }); },
        setLinkUrl(s, e, url) { check(s, e); p.marks.push({ link: p.text.slice(s, e + 1), url }); },
        setBackgroundColor(s, e) { check(s, e); p.marks.push({ highlight: p.text.slice(s, e + 1) }); }
      })
    };
    paras.push(p);
    return api;
  };
  const first = para('');
  const body = {
    getChild: i => { if (i !== 0) throw new Error('only child 0 is mocked'); return first; },
    appendParagraph: text => para(text),
    appendListItem: text => para(text),
    appendHorizontalRule: () => { paras.push({ text: '', rule: true, marks: [] }); },
    getText: () => paras.map(p => p.text).join('\n')
  };
  return { title, paras, getBody: () => body, getId: () => id, getUrl: () => 'https://docs.google.com/document/d/' + id + '/edit', saveAndClose() { world.docs[id] = this; } };
}

/**
 * world.fetch(url, options) → { code, body, headers } decides every network answer.
 * world.failDocCreate (number) makes that many DocumentApp.create calls throw.
 */
function makeGlobals(world) {
  const sheets = {}, script = makeProps(), document = makeProps(), cache = {};
  world.sheets = sheets;
  world.docs = {};
  world.logs = [];
  world.scriptProps = script;
  world.docProps = document;
  let docCount = 0;

  const respond = (url, options) => {
    const r = world.fetch(url, options || {});
    if (r.throws) throw new Error(r.throws);
    return { getResponseCode: () => r.code, getContentText: () => r.body || '', getHeaders: () => r.headers || {} };
  };

  return {
    console,
    Logger: { log: m => world.logs.push(String(m)) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: n => sheets[n] || null,
        insertSheet: n => (sheets[n] = makeSheet(n))
      }),
      getUi: () => { throw new Error('no UI in tests'); },
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; }
    },
    PropertiesService: { getScriptProperties: () => script, getDocumentProperties: () => document },
    CacheService: {
      getDocumentCache: () => ({
        get: k => (k in cache ? cache[k] : null),
        put: (k, v) => { cache[k] = v; },
        remove: k => { delete cache[k]; }
      })
    },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      sleep: () => {},
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => Array.from(crypto.createHash(alg).update(text, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b))
    },
    UrlFetchApp: {
      fetch: respond,
      fetchAll: requests => requests.map(r => respond(r.url, r))
    },
    DocumentApp: {
      ParagraphHeading: { TITLE: 'TITLE', HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3', HEADING4: 'H4', HEADING5: 'H5', HEADING6: 'H6' },
      GlyphType: { BULLET: 'BULLET', NUMBER: 'NUMBER' },
      create(title) {
        if (world.failDocCreate > 0) { world.failDocCreate--; throw new Error('Service Documents failed while accessing document'); }
        return makeDoc('doc' + ++docCount, title, world);
      },
      openById(id) {
        if (!world.docs[id]) throw new Error('Document ' + id + ' is missing');
        return world.docs[id];
      }
    }
  };
}

module.exports = { makeGlobals };
