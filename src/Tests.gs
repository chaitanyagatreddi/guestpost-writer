/**
 * Self-test — checks the pure helpers. Touches no tab, no network and no LLM, so it is free and safe
 * to run any time: Guestpost Writer → Setup → Run self-test. (tests/run.js covers the steps end to end.)
 */

function selfTest_() {
  var failed = [], count = 0;
  function eq(name, got, want) {
    count++;
    if (JSON.stringify(got) !== JSON.stringify(want)) failed.push(name + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want));
  }
  function near(name, got, want) {
    count++;
    if (Math.abs(got - want) > 0.001) failed.push(name + ': got ' + got + ', wanted ' + want);
  }

  near('CTR from "3.2%"', toCtr_('3.2%'), 0.032);
  near('CTR from 0.032', toCtr_(0.032), 0.032);
  near('CTR from 3.2', toCtr_(3.2), 0.032);
  eq('number with comma', toNumber_('1,234'), 1234);

  eq('tokens', tokens_('How to build AI Agents for the web'), ['build', 'ai', 'agent', 'web']);
  eq('slug text', slugText_('https://something.cloud/blog/voice-agents_in-hindi.html'), 'blog voice agents in hindi');
  eq('clean title', cleanTitle_('Voice agents in Hindi | Something'), 'Voice agents in Hindi');

  var pages = [
    { url: 'https://something.cloud/blog/voice-agents', title: 'Voice agents in Indian languages' },
    { url: 'https://something.cloud/pricing', title: 'Pricing' },
    { url: 'https://something.cloud/blog/mcp-guide', title: 'MCP guide for agent builders' }
  ];
  eq('best match', matchPages_('voice agent hindi', pages, 2)[0].url, 'https://something.cloud/blog/voice-agents');
  eq('match skips the page itself', matchPages_('voice agents', pages, 3, 'http://www.something.cloud/blog/voice-agents/').map(function(p) { return p.url; }),
     ['https://something.cloud/blog/mcp-guide']);
  eq('no match', matchPages_('quantum cooking', pages, 3), []);

  var text = 'we built a voice agent that answers support calls in hindi and tamil for small shops';
  near('same text', similarity_(text, text), 1);
  near('different text', similarity_(text, 'pricing a startup product is mostly about knowing which customer you serve first'), 0);
  near('tags are ignored', similarity_('[NEEDS SOURCE] alpha beta gamma', '[NEEDS SOURCE] delta epsilon zeta'), 0);

  eq('absolute link', resolveUrl_('https://a.com/x/y', 'https://b.com/z'), 'https://b.com/z');
  eq('root link', resolveUrl_('https://a.com/x/y', '/z?q=1#top'), 'https://a.com/z?q=1');
  eq('relative link', resolveUrl_('https://a.com/x/y', '../z'), 'https://a.com/z');
  eq('sibling link', resolveUrl_('https://a.com/x/y', 'z'), 'https://a.com/x/z');
  eq('protocol-relative link', resolveUrl_('https://a.com/x', '//b.com/z'), 'https://b.com/z');
  eq('mailto is skipped', resolveUrl_('https://a.com/x', 'mailto:hi@a.com'), '');
  eq('anchor is skipped', resolveUrl_('https://a.com/x', '#top'), '');
  eq('url key', urlKey_('HTTP://WWW.A.com/Blog/?x=1#frag'), 'a.com/Blog?x=1');

  var html = '<html><head><title>Hello &amp; welcome</title><script>var x = "<p>no</p>";</script></head><body><nav><a href="/menu">Menu</a></nav>' +
    '<article><h1>Big idea</h1><p>First&nbsp;para with a <a href="/blog/one">link</a>.</p><ul><li>Point</li></ul></article>' +
    '<footer><a href="https://other.com/x">Other</a></footer></body></html>';
  eq('page title', htmlToText_(html).title, 'Hello & welcome');
  eq('page text', htmlToText_(html).text, '## Big idea\n\nFirst para with a link .\n\n- Point');
  eq('internal links only', extractLinks_(html, 'https://a.com/blog/', { 'a.com': true }), ['https://a.com/menu', 'https://a.com/blog/one']);

  eq('plain JSON', tryParseJSON_('{"a": 1}'), { a: 1 });
  eq('fenced JSON', tryParseJSON_('Here you go:\n```json\n[1, 2]\n```'), [1, 2]);
  eq('JSON in prose', tryParseJSON_('Sure! {"a": [1]} Hope that helps.'), { a: [1] });
  eq('not JSON', tryParseJSON_('no json here'), null);
  eq('list by field', listFrom_({ topics: [1, 2] }, 'topics'), [1, 2]);
  eq('list by first array', listFrom_({ ideas: [3] }, 'topics'), [3]);

  var part = inline_('See **this** and [our guide](https://a.com/g) [NEEDS SOURCE]');
  eq('inline text', part.text, 'See this and our guide [NEEDS SOURCE]');
  eq('inline marks', part.marks.map(function(k) { return [k.start, k.end, !!k.bold, k.url || '', !!k.highlight]; }),
     [[4, 7, true, '', false], [13, 21, false, 'https://a.com/g', false], [23, 36, false, '', true]]);

  eq('formula-like text is stored as text', safeCell_('=IMPORTXML("x")'), '\'=IMPORTXML("x")');
  eq('negative number is left alone', safeCell_('-5'), '-5');

  return { count: count, failed: failed };
}

function runSelfTest() {
  var r = selfTest_();
  notify_('Self-test', r.failed.length ? r.failed.length + ' of ' + r.count + ' checks failed:\n\n' + r.failed.join('\n') : 'All ' + r.count + ' checks passed.');
  return r;
}
