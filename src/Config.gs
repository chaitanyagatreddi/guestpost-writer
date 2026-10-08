/**
 * Config — everything project-specific that is not a step: tab layouts and settings.
 *
 * To reuse this template for another Sheet tool, edit this file, Prompts.gs and Code.gs.
 * Core.gs and Helpers.gs do not know about guest posts and can be copied as they are.
 */

var APP_NAME = 'Guestpost Writer';

// Stop cleanly before Apps Script's 6-minute limit so no run is killed halfway.
var RUN_BUDGET_MS = 4.5 * 60 * 1000;

// Tags the LLM leaves for a person to fill in. Highlighted in every Doc.
var HIGHLIGHT_TAGS = ['NEEDS SOURCE', 'FOUNDER STORY'];

// ---------- Tabs ----------

var T = {
  CONFIG: 'Config', QUERIES: 'Queries', PAGES: 'Pages', SITEMAP: 'Sitemap', PUBLICATIONS: 'Publications',
  OPPS: 'Opportunities', TOPICS: 'Topics', DRAFTS: 'Drafts', COPIES: 'Copies', BROKEN: 'Broken Links',
  LOG: 'Run Log', LINKS: '_Links', SOURCES: '_Sources'
};

// Tab → header row. Code finds columns by header name, never by position, so columns can be
// reordered in the Sheet. Add new columns at the end; Setup only ever adds missing headers.
var TABS = {};
TABS[T.CONFIG]       = ['Key', 'Value', 'What it does'];
TABS[T.QUERIES]      = ['Query', 'Clicks', 'Impressions', 'CTR', 'Position'];
TABS[T.PAGES]        = ['Page', 'Clicks', 'Impressions', 'CTR', 'Position'];
TABS[T.SITEMAP]      = ['URL', 'Title', 'Status Code', 'Last Checked', 'Redirects To'];
TABS[T.PUBLICATIONS] = ['Name', 'URL', 'Audience', 'Topics Accepted', 'AI Policy', 'Link Policy', 'Contact', 'Status'];
TABS[T.OPPS]         = ['ID', 'Type', 'Query', 'Page', 'Impressions', 'Position', 'CTR', 'Detail', 'Created',
                        'Target Page', 'Link From 1', 'Link From 2', 'Link From 3', 'Anchor', 'Links Status'];
TABS[T.TOPICS]       = ['ID', 'Title', 'Angle', 'Target Query', 'Author', 'Publication', 'Pages to Link', 'Score',
                        'Score Reason', 'Status', 'Why This Publication', 'Doc Link', 'Data Note'];
TABS[T.DRAFTS]       = ['ID', 'Topic ID', 'Doc Link', 'Status', 'Source URL', 'Similarity Flag', 'Approved By',
                        'Approved Date', 'Title', 'Type', 'Doc ID', 'Created'];
TABS[T.COPIES]       = ['Source URL', 'Angle', 'Author', 'Publication', 'Format', 'Length', 'Doc Link',
                        'Similarity Flag', 'Title', 'Main Examples', 'Copies Wanted', 'Pasted Text', 'Status', 'Message'];
TABS[T.BROKEN]       = ['Broken URL', 'Status Code', 'Linked From', 'In GSC?', 'Impressions', 'Suggested Replacement', 'Action'];
TABS[T.LOG]          = ['Time', 'Run ID', 'Step', 'Stage', 'Status', 'Detail', 'ms'];
TABS[T.LINKS]        = ['URL', 'Status Code', 'Linked From', 'Last Checked'];
TABS[T.SOURCES]      = ['Source URL', 'Title', 'Text', 'Note', 'Fetched'];

// Working tabs the intern never needs to open.
var HIDDEN_TABS = [T.LINKS, T.SOURCES];

// A GSC export names its first column differently; treat these as the same header.
var HEADER_ALIASES = { 'top queries': 'query', 'top pages': 'page' };

var TOPIC_STATUSES = ['Proposed', 'Approved', 'Drafted', 'Rejected'];

// ---------- Settings ----------

// [key, default, what it does]. Setup copies these into the Config tab, where they can be changed
// without touching code. The one secret, LLM_API_KEY, is kept in Script Properties and never in a cell.
var SETTINGS = [
  ['BRAND_NAME', 'Something', 'Product name used in prompts'],
  ['SITE_DOMAINS', 'something.cloud, trysomething.sh', 'Our domains, comma-separated. Links to these count as internal'],
  ['ABOUT', 'Something (something.cloud) is an AI agent-builder platform.', 'Two or three lines on what the product does. Sent to the LLM'],
  ['AUTHORS', 'Aankit Roy (CEO) = founder journey, building a startup in Bengaluru, fundraising, go-to-market\n' +
              'Shinjan Patra (CTO) = technical / AI agents, voice agents in Indian languages, MCP, architecture',
              'One author per line: Name = what they write about'],
  ['MONEY_PAGES', '', 'Pages drafts should link to first, one URL per line. Blank = pick by keyword match'],
  ['SITEMAP_URLS', '', 'Sitemap XML address(es) for Setup → Import sitemap'],
  ['IMPRESSION_THRESHOLD', 10, 'Step 1: ignore queries and pages with fewer impressions than this'],
  ['POSITION_MIN', 8, 'Step 1: striking distance starts at this position'],
  ['POSITION_MAX', 20, 'Step 1: striking distance ends at this position'],
  ['LOW_CTR_RATIO', 0.5, 'Step 1: a page is "low CTR" when its CTR is under this share of the site average'],
  ['LOW_DATA_MIN', 5, 'Fewer opportunities than this = "low data": Step 3 picks topics on fit'],
  ['TOPIC_COUNT', 5, 'Step 3: how many topic ideas to ask for'],
  ['DRAFT_WORDS', 1000, 'Step 4: target length of a guest post draft'],
  ['DRAFTS_PER_RUN', 3, 'Steps 4 and 5b: most drafts written per click, so a run stays under 6 minutes'],
  ['MIN_ARTICLE_WORDS', 150, 'Step 5: a fetched page with fewer words than this counts as unreadable'],
  ['SIMILARITY_THRESHOLD', 0.25, 'Step 5: flag two pieces sharing more than this share of 3-word phrases'],
  ['FETCH_BATCH', 10, 'Step 6: URLs checked at once'],
  ['FETCH_PAUSE_MS', 500, 'Step 6: pause between batches, in milliseconds'],
  ['LLM_MODEL', 'gpt-4o-mini', 'Model ID'],
  ['LLM_ENDPOINT', 'https://api.openai.com/v1/chat/completions', 'Chat completions URL'],
  ['LLM_MAX_TOKENS', 4000, 'Most tokens the LLM may write per call'],
  ['LLM_TEMPERATURE', 0.7, 'Higher = more varied writing'],
  ['LLM_JSON_MODE', 'true', 'Ask for JSON mode on planning calls. Set to false if your endpoint rejects response_format']
];
