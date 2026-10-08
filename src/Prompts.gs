/**
 * Prompts — every word sent to the LLM. Edit here to change what the tool writes.
 */

var COPY_FORMATS = 'how-to, opinion, listicle, case study, LinkedIn post';

/** Sent with every call: who we are and the rules that never change. */
function systemPrompt_() {
  return [
    'You write for ' + setting_('BRAND_NAME') + ' (' + setting_('SITE_DOMAINS') + ').',
    'About the company: ' + setting_('ABOUT'),
    'Authors and what each one writes about:',
    setting_('AUTHORS'),
    '',
    'Rules that always apply:',
    '- Use only the data you are given. Do not invent statistics, customers, quotes or case studies.',
    '- Put [NEEDS SOURCE] right after any claim that needs evidence.',
    '- Where a real founder example belongs, write [FOUNDER STORY: what kind of story fits here] instead of making one up.',
    '- Direct, conversational tone. Not corporate.'
  ].join('\n');
}

function linkRule_(links) {
  return 'Link naturally to 1–2 of these pages, as Markdown links, and add no other links:\n' + links.join('\n');
}

/** Step 3. d: { opps, pages, pubs, lowData } */
function topicsPrompt_(d) {
  return [
    'Propose ' + settingNum_('TOPIC_COUNT') + ' guest-post topic ideas for us.',
    d.lowData
      ? 'We have little search data so far. Choose topics on fit: what each publication accepts, what each author can credibly write, and the pages we have.'
      : 'Start from the search opportunities below: queries we almost rank for, and pages that get seen but not clicked.',
    'Use only the data given; do not invent statistics. Return JSON.',
    '',
    'Each idea needs:',
    '- title',
    '- angle: the main argument, in one or two sentences',
    '- target_query: one query copied from Opportunities, or "" if none fits',
    '- author: one of our authors, matched to what they write about',
    '- publication: the best-fit name copied from Publications',
    '- publication_why: why this idea fits that publication',
    '- pages_to_link: 1 to 3 URLs copied exactly from Pages',
    '- score: fit from 1 to 10',
    '- score_reason: one sentence',
    '',
    'Return JSON shaped like {"topics": [{"title": "...", "angle": "...", "target_query": "...", "author": "...", "publication": "...", "publication_why": "...", "pages_to_link": ["..."], "score": 8, "score_reason": "..."}]}',
    '',
    'Opportunities:', JSON.stringify(d.opps),
    '',
    'Pages:', JSON.stringify(d.pages),
    '',
    'Publications:', JSON.stringify(d.pubs)
  ].join('\n');
}

/** Step 4. topic: a Topics row. links: URLs the draft may link to. */
function draftPrompt_(topic, links) {
  return [
    'Write a guest post draft of about ' + settingNum_('DRAFT_WORDS') + ' words.',
    '',
    'Title: ' + topic.title,
    'Angle: ' + topic.angle,
    'Author: ' + topic.author,
    'Publication: ' + topic.publication,
    'Target query: ' + (topic['target query'] || '(none)'),
    '',
    linkRule_(links),
    '',
    'Return Markdown only, in this order:',
    '## Outline',
    '- one bullet per section heading',
    '---',
    '# ' + topic.title,
    'then the full draft, with ## section headings.'
  ].join('\n');
}

/** Step 5, call A. source: { title, text }. n: how many briefs. pubs: Publications rows. */
function copyPlanPrompt_(source, n, pubs) {
  return [
    'From this article, create ' + n + ' pieces that are clearly different from each other.',
    'Each must differ in: angle/main argument, examples, structure, title, author, target publication (from the list), format (' + COPY_FORMATS + ') and length.',
    'No two may share the same angle, the same format+author pair, or the same main examples.',
    'Return JSON.',
    '',
    'Each piece needs:',
    '- title',
    '- angle: the main argument, in one or two sentences',
    '- main_examples: the examples it will lean on, in a few words',
    '- structure: how it is organised, in a few words',
    '- author: one of our authors',
    '- publication: a name copied from Publications',
    '- format: one of ' + COPY_FORMATS,
    '- length_words: a number',
    '',
    'Return JSON shaped like {"copies": [{"title": "...", "angle": "...", "main_examples": "...", "structure": "...", "author": "...", "publication": "...", "format": "...", "length_words": 800}]}',
    '',
    'Publications:', JSON.stringify(pubs),
    '',
    'Article title: ' + source.title,
    'Article:', source.text
  ].join('\n');
}

/** Step 5, call B. brief: a Copies row. siblings: the other briefs from the same source. */
function copyDraftPrompt_(brief, source, siblings, links) {
  var others = siblings.map(function(s) {
    return '- ' + s.title + ' — ' + s.angle + (s['main examples'] ? ' (examples: ' + s['main examples'] + ')' : '');
  });
  return [
    'Write this piece from the brief. It is one of several pieces based on the same source article, and each must read as a different piece.',
    '',
    'Title: ' + brief.title,
    'Angle: ' + brief.angle,
    'Main examples: ' + (brief['main examples'] || '(your choice, within the rules)'),
    'Author: ' + brief.author,
    'Publication: ' + brief.publication,
    'Format: ' + brief.format,
    'Length: about ' + (toNumber_(brief.length) || 800) + ' words',
    '',
    'Do not reuse sentences or examples from the source or other copies.',
    linkRule_(links),
    '',
    'Return Markdown only. Start with "# ' + brief.title + '". Use ## headings only if the format calls for them.',
    '',
    'The other pieces, so you can stay away from their angles and examples:',
    others.length ? others.join('\n') : '(none)',
    '',
    'Source article, for facts only — do not copy its wording:',
    source.text
  ].join('\n');
}
