/**
 * End-to-end test of src/*.gs under Node, with Sheets, Docs, the site and the LLM mocked.
 * Run:  node tests/run.js           (no install needed; exits 1 on any failure)
 *       node tests/run.js --show    also prints the messages a person would see in the Sheet
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeGlobals } = require('./mocks');

const SRC = path.join(__dirname, '..', 'src');
const FILES = ['Config.gs', 'Core.gs', 'Helpers.gs', 'Prompts.gs', 'Code.gs', 'Tests.gs'];

// ---------- A fake site, blog and LLM ----------

const SITE = 'https://something.cloud';
const page = (title, links) => ({
  code: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: `<html><head><title>${title}</title></head><body><main><h1>${title}</h1>` + (links || []).map(h => `<a href="${h}">x</a>`).join(' ') + '</main></body></html>'
});
const SITE_PAGES = {
  '/': page('Something — build AI agents', ['/pricing', '/blog/voice-agents', '/gone-page', '/old-url', '/missing-guide', 'https://external.com/x', 'mailto:hi@something.cloud', '#top']),
  '/pricing': page('Pricing | Something'),
  '/blog/voice-agents': page('Voice agents in Indian languages | Something', ['mcp-guides', '../pricing']),
  '/blog/ai-agent-builder-guide': page('AI agent builder guide | Something'),
  '/blog/mcp-guide': page('MCP guide for agent builders | Something'),
  '/old-url': { code: 301, headers: { Location: '/pricing' } },
  '/sitemap.xml': { code: 200, body: `<sitemapindex><sitemap><loc>${SITE}/pages.xml</loc></sitemap></sitemapindex>` },
  '/pages.xml': { code: 200, body: `<urlset><url><loc>${SITE}/pricing</loc></url><url><loc>${SITE}/about?a=1&amp;b=2</loc></url></urlset>` }
};

const words = (seed, n) => Array.from({ length: n }, (_, i) => seed + 'w' + i).join(' ');
const ARTICLE = `<html><head><title>How we built voice agents</title></head><body><article><h1>How we built voice agents</h1><p>${words('source', 220)}</p></article></body></html>`;

const draftFor = title => [
  '## Outline', '- Why this matters', '- What we learned', '---', '# ' + title, '',
  'Start here with **one bold claim** [NEEDS SOURCE] and see [our pricing](https://something.cloud/pricing).', '',
  '## What we learned', '', '1. First point', '2. Second point', '', '[FOUNDER STORY: the first customer call]', '',
  words(/^Dup/.test(title) ? 'dup' : title.replace(/\W/g, '').toLowerCase(), 150)
].join('\n');

const TOPICS = [
  { title: 'Voice agents for Indian languages', angle: 'Why Hindi-first beats translation.', target_query: 'voice agents hindi', author: 'Shinjan Patra', publication: 'Dev Weekly', publication_why: 'They cover agent builds.', pages_to_link: [SITE + '/blog/voice-agents', SITE + '/made-up-page'], score: 9, score_reason: 'Direct fit.' },
  { title: 'From zero to first customer', angle: 'What the first ten calls taught us.', target_query: '', author: 'Aankit Roy', publication: 'Unknown Mag', publication_why: 'Founder stories.', pages_to_link: SITE + '/pricing', score: 7, score_reason: 'Good fit.' },
  { title: 'An agent builder checklist', angle: 'Seven checks before you ship.', target_query: 'ai agent builder', author: 'Shinjan Patra', publication: 'Dev Weekly', publication_why: 'Practical.', pages_to_link: [SITE + '/blog/ai-agent-builder-guide'], score: 8, score_reason: 'Matches the query.' },
  { title: 'MCP in plain words', angle: 'What MCP changes for builders.', target_query: '', author: 'Shinjan Patra', publication: 'Founder Notes', publication_why: 'Explainers.', pages_to_link: [SITE + '/blog/mcp-guide'], score: 6, score_reason: 'Fair fit.' },
  { title: 'No angle here' }
];
const BRIEFS = ['Copy A', 'Dup one', 'Dup two', 'Copy D', 'Copy E', 'Copy F'].map((title, i) => ({
  title, angle: 'Angle ' + title, main_examples: 'Example ' + i, structure: 'three parts',
  author: i % 2 && i !== 3 ? 'Aankit Roy' : 'Shinjan Patra', publication: 'Dev Weekly', format: ['how-to', 'opinion', 'listicle', 'how-to', 'LinkedIn post', 'case study'][i], length_words: 600 + i * 50
}));

const world = { llmCalls: [], llmStatus: 0, failDocCreate: 0, fetchLog: [], writes: [] };
world.fetch = (url, options) => {
  world.fetchLog.push(url);
  world.midRun = JSON.parse(world.docProps.getProperty('gpw.state.brokenLinks') || '{}').status;
  if (options.method && options.method !== 'get') world.writes.push(url);
  if (url === 'https://api.openai.com/v1/chat/completions') {
    const body = JSON.parse(options.payload), user = body.messages[body.messages.length - 1].content;
    world.llmCalls.push({ user, body, auth: options.headers.Authorization });
    if (world.llmStatus) return { code: world.llmStatus, body: JSON.stringify({ error: { message: 'Incorrect API key provided' } }) };
    let content;
    if (/topic ideas/.test(user)) content = JSON.stringify({ topics: TOPICS });
    else if (/clearly different/.test(user)) content = '```json\n' + JSON.stringify({ copies: BRIEFS.slice(0, +user.match(/create (\d+) pieces/)[1]) }) + '\n```';
    else if (/single word/.test(user)) content = 'ok';
    else content = draftFor(user.match(/^Title: (.*)$/m)[1]);
    return { code: 200, body: JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }) };
  }
  if (url === 'https://blog.example.com/post-1') return { code: 200, headers: { 'Content-Type': 'text/html' }, body: ARTICLE };
  if (url === 'https://blog.example.com/js-page') return { code: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body><div id="root"></div><script>render()</script></body></html>' };
  if (url.indexOf(SITE) === 0) return SITE_PAGES[url.slice(SITE.length) || '/'] || { code: 404, headers: { 'Content-Type': 'text/html' }, body: 'Not found' };
  return { throws: 'DNS error: ' + url };
};

// ---------- Load the tool ----------

const g = vm.createContext(makeGlobals(world));
vm.runInContext(FILES.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n'), g, { filename: 'src.gs' });

// ---------- Tiny test kit ----------

let passed = 0;
const samples = [];
const failures = [];
function check(name, condition, detail) {
  if (condition) passed++;
  else failures.push(name + (detail !== undefined ? '\n      ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''));
}
const same = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const rows = tab => g.readTable_(tab);
const fill = (tab, list) => g.appendRows_(tab, list);
const setConfig = (key, value) => g.updateRow_('Config', rows('Config').find(r => r.key === key)._row, { value });
const llmCount = pattern => world.llmCalls.filter(c => pattern.test(c.user)).length;
const logRows = () => rows('Run Log');
function section(name, fn) {
  try { fn(); } catch (e) { failures.push(name + ' — threw: ' + (e.stack || e.message)); }
}

// ---------- Tests ----------

section('helpers', () => {
  const r = g.selfTest_();
  check('self-test: ' + r.count + ' helper checks', r.failed.length === 0, r.failed.join('\n      '));
});

section('before setup', () => {
  const r = g.findOpportunities();
  same('step 1 is blocked until tabs exist', r.status, 'blocked');
  check('…and says how to fix it', /Create \/ repair tabs/.test(r.fix), r);
});

section('setup', () => {
  world.scriptProps.setProperty('IMPRESSION_THRESHOLD', '10');
  g.setupTabs();
  same('all tabs created', Object.keys(world.sheets).length, 13);
  check('working tabs are hidden', world.sheets._Links.hidden && world.sheets._Sources.hidden);
  same('config rows seeded', rows('Config').length, g.SETTINGS.length);
  g.setupTabs();
  same('setup is safe to run twice', rows('Config').length, g.SETTINGS.length);
  same('headers not duplicated', g.headers_(world.sheets.Topics).length, g.TABS.Topics.length);
});

section('low data', () => {
  const r = g.findOpportunities();
  same('step 1 runs with no GSC data', r.status, 'ok');
  same('…and writes a low-data row', rows('Opportunities').map(o => o.type), ['low-data']);
  check('…and says so', /LOW DATA/.test(r.message), r.message);
});

section('step 1: opportunities', () => {
  world.sheets.Queries.getRange(1, 1).setValue('Top queries');   // what a pasted GSC export looks like
  world.sheets.Pages.getRange(1, 1).setValue('Top pages');
  fill('Queries', [
    { query: 'ai agent builder', clicks: 3, impressions: 240, ctr: '1.2%', position: 12.34 },
    { query: 'voice agents hindi', clicks: 2, impressions: 80, ctr: 0.025, position: 9 },
    { query: 'something login', clicks: 300, impressions: 500, ctr: '60%', position: 1.2 },
    { query: 'mcp server guide', clicks: 0, impressions: 5, ctr: '0%', position: 15 },
    { query: 'quantum cooking tips', clicks: 0, impressions: 30, ctr: '0%', position: 18 }
  ]);
  fill('Pages', [
    { page: SITE + '/', clicks: 50, impressions: '1,000', ctr: '5%', position: 3 },
    { page: SITE + '/blog/voice-agents', clicks: 1, impressions: 400, ctr: '0.25%', position: 11 },
    { page: SITE + '/pricing', clicks: 20, impressions: 300, ctr: '6.67%', position: 4 },
    { page: SITE + '/old-post', clicks: 0, impressions: 60, ctr: '0%', position: 30 },
    { page: SITE + '/gone-page', clicks: 1, impressions: 25, ctr: '4%', position: 9 }
  ]);
  const r = g.findOpportunities(), opps = rows('Opportunities');
  same('step 1 ok', r.status, 'ok');
  same('striking-distance queries, most impressions first', opps.filter(o => o.type === 'striking-distance').map(o => o.query),
       ['ai agent builder', 'voice agents hindi', 'quantum cooking tips']);
  same('low-CTR pages', opps.filter(o => o.type === 'low-ctr').map(o => o.page), [SITE + '/blog/voice-agents', SITE + '/old-post']);
  check('site average uses clicks / impressions', /site average 4\.0%/.test(opps[3].detail), opps[3].detail);
  same('position is rounded', opps[0].position, 12.3);
});

section('step 2: internal links', () => {
  let r = g.suggestInternalLinks();
  same('step 2 is blocked without a sitemap', r.status, 'blocked');
  check('…and the trace shows step 1 as good', /✓ 1\. Find Opportunities/.test(g.reportText_(r)), g.reportText_(r));
  fill('Sitemap', ['/', '/pricing', '/blog/voice-agents', '/blog/ai-agent-builder-guide', '/blog/mcp-guide', '/gone-page'].map(p => ({ url: SITE + p })));
  r = g.suggestInternalLinks();
  const opps = rows('Opportunities');
  same('step 2 ok', r.status, 'ok');
  same('query → target page by keyword', opps[0]['target page'], SITE + '/blog/ai-agent-builder-guide');
  same('…with a page to link from', opps[0]['link from 1'], SITE + '/blog/voice-agents');
  same('…and the query as anchor', opps[0].anchor, 'ai agent builder');
  check('unmatched query is a content gap', /content gap/.test(opps[2]['links status']), opps[2]);
  same('low-CTR page is its own target', opps[3]['target page'], SITE + '/blog/voice-agents');
  check('…and never links to itself', [opps[3]['link from 1'], opps[3]['link from 2'], opps[3]['link from 3']].indexOf(SITE + '/blog/voice-agents') === -1);
});

section('step 3: topics', () => {
  let r = g.generateTopics();
  same('step 3 is blocked without an API key', r.status, 'blocked');
  world.scriptProps.setProperty('LLM_API_KEY', 'sk-test');
  r = g.generateTopics();
  check('…then blocked without publications', r.status === 'blocked' && /Publications/.test(r.message), r);
  fill('Publications', [{ name: 'Dev Weekly', url: 'https://devweekly.example', audience: 'developers' }, { name: 'Founder Notes', url: 'https://fn.example', audience: 'founders' }]);

  world.llmStatus = 401;
  r = g.generateTopics();
  same('a rejected key fails the step', r.status, 'failed');
  same('…at the LLM stage', r.failedAt, 'Ask the LLM for topic ideas › LLM call');
  same('…after the last good stage', r.lastOk, 'Collect opportunities, pages and publications');
  check('…with the fix', /Set LLM API key/.test(r.fix), r.fix);
  world.llmStatus = 0;

  r = g.resumeLastRun();
  const topics = rows('Topics'), call = world.llmCalls[world.llmCalls.length - 1];
  same('resume finishes step 3', r.status, 'ok');
  same('four valid topics kept, the one with no angle dropped', topics.map(t => t.id), [1, 2, 3, 4]);
  same('invented link removed', topics[0]['pages to link'], SITE + '/blog/voice-agents');
  check('…and noted', /1 link\(s\) removed/.test(topics[0]['data note']), topics[0]['data note']);
  check('unknown publication noted', /not in the Publications tab/.test(topics[1]['data note']), topics[1]['data note']);
  same('new topics start as Proposed', topics.map(t => t.status).join(), 'Proposed,Proposed,Proposed,Proposed');
  same('key sent as a bearer token', call.auth, 'Bearer sk-test');
  same('JSON mode requested', call.body.response_format, { type: 'json_object' });
  check('prompt carries the rules', /do not invent statistics/i.test(call.user) && /NEEDS SOURCE/.test(call.body.messages[0].content));
  check('prompt carries real data', /ai agent builder/.test(call.user) && /Dev Weekly/.test(call.user));
});

section('step 4: drafts, failure and resume', () => {
  let r = g.draftApprovedTopics();
  same('step 4 is blocked until a founder approves', r.status, 'blocked');
  check('…and says who must act', /founder sets Status to "Approved"/.test(r.fix), r.fix);
  same('resume also refuses and explains', g.resumeLastRun().status, 'blocked');
  check('…naming the last good step', /Last good step: 3\. Generate Topics/.test(world.logs[world.logs.length - 1]), world.logs[world.logs.length - 1]);

  g.updateRow_('Topics', 2, { status: 'Approved' });
  g.updateRow_('Topics', 4, { status: 'approved' });
  world.failDocCreate = 1;
  r = g.draftApprovedTopics();
  same('a Docs error fails the step', r.status, 'failed');
  same('…at the exact sub-step', r.failedAt, 'Write drafts › Topic 1: create Google Doc');
  same('…with the last successful one recorded', r.lastOk, 'Write drafts › Topic 1: LLM draft');
  same('one draft paid for so far', llmCount(/guest post draft/), 1);
  samples.push(g.reportText_(r));
  check('the report shows the trace', /Failed at: Write drafts › Topic 1: create Google Doc[\s\S]*✓ Founder approves a topic[\s\S]*✗ 4\. Draft Approved Topics/.test(g.reportText_(r)), g.reportText_(r));

  r = g.resumeLastRun();
  const drafts = rows('Drafts'), topics = rows('Topics');
  same('resume completes step 4', r.status, 'ok');
  same('the paid draft was reused, only topic 3 was new', llmCount(/guest post draft/), 2);
  check('Run Log shows the reuse', logRows().some(l => l.status === 'CACHED' && /Topic 1: LLM draft/.test(l.stage)));
  same('two drafts recorded', drafts.map(d => [d.id, d['topic id'], d.type, d.status]), [[1, 1, 'guest post', 'Draft'], [2, 3, 'guest post', 'Draft']]);
  same('topics marked', topics.map(t => t.status), ['Drafted', 'Proposed', 'Drafted', 'Proposed']);
  same('no duplicate Docs', Object.keys(world.docs).length, 2);

  const doc = world.docs[drafts[0]['doc id']], find = t => doc.paras.find(p => p.text.indexOf(t) === 0);
  same('Doc title', doc.paras[0].text, 'Draft: Voice agents for Indian languages');
  same('Doc has the outline heading', find('Outline').heading, 'H2');
  same('Doc has list items', doc.paras.filter(p => p.list).map(p => p.list), ['BULLET', 'BULLET', 'NUMBER', 'NUMBER']);
  same('Doc line is styled', find('Start here').marks, [{ bold: 'one bold claim' }, { link: 'our pricing', url: SITE + '/pricing' }, { highlight: '[NEEDS SOURCE]' }]);
  same('founder tag is highlighted', find('[FOUNDER STORY').marks, [{ highlight: '[FOUNDER STORY: the first customer call]' }]);
  same('step 4 with nothing waiting', g.draftApprovedTopics().message, 'No approved topics are waiting for a draft.');
});

section('step 5: blog → copies', () => {
  let r = g.planCopies();
  same('5a is blocked with no URL', r.status, 'blocked');
  fill('Copies', [{ 'source url': 'https://blog.example.com/post-1', 'copies wanted': 5 }, { 'source url': 'https://blog.example.com/js-page', 'copies wanted': 2 }]);
  r = g.planCopies();
  let copies = rows('Copies');
  same('5a ok', r.status, 'ok');
  same('five briefs for the readable page', copies.filter(c => c.status === 'Planned').map(c => c.title), ['Copy A', 'Dup one', 'Dup two', 'Copy D', 'Copy E']);
  same('unreadable page is marked', copies[1].status, 'Paste needed');
  check('…with the paste message', /Couldn't read page .*paste the text instead/.test(copies[1].message) && /paste the text instead/.test(r.message), copies[1].message);
  check('repeated format + author is flagged', /same format \+ author/.test(copies.find(c => c.title === 'Copy D').message), copies);
  same('article saved once', rows('_Sources').map(s => s.title), ['How we built voice agents']);

  g.updateRow_('Copies', 3, { 'pasted text': 'Pasted article title\n' + words('pasted', 200) });
  r = g.planCopies();
  copies = rows('Copies');
  same('after pasting, the second source is planned', copies.filter(c => c['source url'].indexOf('js-page') > -1).map(c => c.status), ['Planned', 'Planned']);
  same('pasted text is tucked away', copies[1]['pasted text'], '(saved)');
  same('seven briefs in total', copies.length, 7);
  same('5a with nothing new', /No new blog URLs/.test(g.planCopies().message), true);

  const before = llmCount(/Write this piece/);
  r = g.draftCopies();
  same('5b pauses after a batch of three', r.status, 'paused');
  check('…and says how many are left', /3 copies written, 4 left/.test(r.message), r.message);
  samples.push(g.reportText_(r));
  r = g.resumeLastRun();
  same('resume writes the next batch', r.status, 'paused');
  r = g.draftCopies();
  copies = rows('Copies');
  const drafts = rows('Drafts').filter(d => d.type === 'copy');
  same('third run finishes', r.status, 'ok');
  same('one LLM call per copy', llmCount(/Write this piece/) - before, 7);
  same('every copy has its own Doc', new Set(copies.map(c => c['doc link'])).size, 7);
  same('every copy is in Drafts', drafts.length, 7);
  const flag = t => copies.find(c => c.title === t)['similarity flag'];
  check('near-identical copies are flagged', /^TOO CLOSE — rewrite: \d+% vs draft \d+$/.test(flag('Dup one')) && /^TOO CLOSE/.test(flag('Dup two')), [flag('Dup one'), flag('Dup two')]);
  check('different copies pass', /^OK — closest is \d+% \(draft \d+\)$/.test(flag('Copy A')), flag('Copy A'));
  check('Drafts carries the flag too', drafts.every(d => d['similarity flag']), drafts.map(d => d['similarity flag']));
  const prompt = world.llmCalls.filter(c => /Write this piece/.test(c.user))[0].user;
  check('copy prompt has the reuse rule and the sibling briefs', /Do not reuse sentences or examples from the source or other copies/.test(prompt) && /Dup one — Angle Dup one/.test(prompt));
  same('5c re-check works on its own', g.checkSimilarity().status, 'ok');
});

section('step 6: broken links', () => {
  g.RUN_BUDGET_MS = -1;
  let r = g.checkBrokenLinks();
  same('step 6 pauses when time runs out', r.status, 'paused');
  check('…with progress', /0 of 6 sitemap URLs checked/.test(r.message), r.message);
  g.RUN_BUDGET_MS = 270000;
  setConfig('FETCH_BATCH', 4);
  world.fetchLog.length = 0;
  r = g.resumeLastRun();
  const sitemap = rows('Sitemap'), broken = rows('Broken Links'), by = u => broken.find(b => b['broken url'] === SITE + u);
  same('resume finishes step 6', r.status, 'ok');
  same('sitemap statuses recorded', sitemap.map(s => s['status code']), [200, 200, 200, 200, 200, 404]);
  same('page title filled in', sitemap[2].title, 'Voice agents in Indian languages | Something');
  same('each URL fetched once', world.fetchLog.length, new Set(world.fetchLog).size);
  same('broken URLs, traffic first', broken.map(b => b['broken url']), ['/old-post', '/gone-page', '/missing-guide', '/blog/mcp-guides'].map(p => SITE + p));
  same('redirects and outside links are not listed', broken.some(b => /old-url|external/.test(b['broken url'])), false);
  same('linked-from and sitemap noted', by('/gone-page')['linked from'], SITE + '/\n(sitemap)');
  same('GSC cross-check', [by('/gone-page')['in gsc?'], by('/gone-page').impressions, by('/missing-guide')['in gsc?']], ['Yes', 25, 'No']);
  check('page with impressions gets a redirect', /^Fix first .*301 redirect/.test(by('/old-post').action), by('/old-post').action);
  same('typo link gets the closest live page', by('/blog/mcp-guides')['suggested replacement'], SITE + '/blog/mcp-guide');
  same('…and an update-link action', by('/blog/mcp-guides').action, `Update the link on ${SITE}/blog/voice-agents to ${SITE}/blog/mcp-guide.`);
  check('nothing is fetched twice on a second run', (world.fetchLog.length = 0, g.checkBrokenLinks().status === 'ok' && world.fetchLog.length === 0), world.fetchLog);

  same('a run in flight is marked, so a killed run can be resumed', world.midRun, 'interrupted');
  const cut = { key: 'brokenLinks', label: '6. Check Broken Links', status: 'interrupted', runId: r.runId, message: 'The run stopped before it finished.' };
  check('a cut-off run reports its last good stage from the Run Log', /Last successful step: Cross-check with GSC and suggest fixes/.test(g.reportText_(cut)), g.reportText_(cut));

  g.resetBrokenLinkCheck();
  same('reset clears the check', [rows('Broken Links').length, rows('_Links').length, rows('Sitemap')[0]['status code']], [0, 0, '']);
});

section('sitemap import and status', () => {
  let r = g.importSitemap();
  same('import needs SITEMAP_URLS', r.status, 'failed');
  setConfig('SITEMAP_URLS', SITE + '/sitemap.xml');
  r = g.resumeLastRun();
  same('import follows a sitemap index', r.status, 'ok');
  same('only the new URL is added', rows('Sitemap').map(s => s.url).slice(-1), [SITE + '/about?a=1&b=2']);
  const text = g.showStatus();
  samples.push(text);
  check('status board lists every step', /✓ 4\. Draft Approved Topics/.test(text) && /✗ 6\. Check Broken Links/.test(text), text);
  g.testLlm();
  check('LLM test reports success', /Working\. gpt-4o-mini replied: ok/.test(world.logs[world.logs.length - 1]), world.logs[world.logs.length - 1]);
});

section('safety', () => {
  check('the API key never lands in a cell', !Object.values(world.sheets).some(s => JSON.stringify(s._data).indexOf('sk-test') > -1));
  check('every run left a log trail', logRows().filter(l => l.status === 'START').length > 15 && logRows().some(l => l.status === 'FAIL') && logRows().some(l => l.status === 'PAUSED'));
  same('the only non-GET requests went to the LLM', [...new Set(world.writes)], ['https://api.openai.com/v1/chat/completions']);
});

// ---------- Report ----------

if (process.argv.includes('--show')) samples.forEach(t => console.log('\n' + '-'.repeat(72) + '\n' + t));

console.log(`\n${passed} passed, ${failures.length} failed`);
failures.forEach(f => console.log('  ✗ ' + f));
process.exit(failures.length ? 1 : 0);
