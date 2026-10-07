/**
 * Helpers — LLM calls, sheet parsing, text utils.
 */

// ---------- Config ----------

function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    llmApiKey: props.getProperty('LLM_API_KEY') || '',
    llmModel: props.getProperty('LLM_MODEL') || 'gpt-4o-mini',
    llmEndpoint: props.getProperty('LLM_ENDPOINT') || 'https://api.openai.com/v1/chat/completions',
    impressionThreshold: parseInt(props.getProperty('IMPRESSION_THRESHOLD')) || 10
  };
}

// ---------- LLM ----------

function callLLM_(prompt, config) {
  if (!config.llmApiKey) {
    throw new Error('No LLM_API_KEY in Script Properties. Go to Extensions → Apps Script → Project Settings → Script Properties.');
  }

  var payload = {
    model: config.llmModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 4000
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + config.llmApiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(config.llmEndpoint, options);
  var json = JSON.parse(response.getContentText());

  if (json.error) {
    throw new Error('LLM error: ' + json.error.message);
  }

  return json.choices[0].message.content;
}

// ---------- Sheet data ----------

function getSheetData_(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

// ---------- Text utils ----------

function stripHtml_(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity_(a, b) {
  var wordsA = a.toLowerCase().split(/\s+/);
  var wordsB = new Set(b.toLowerCase().split(/\s+/));
  var overlap = wordsA.filter(function(w) { return wordsB.has(w); }).length;
  return overlap / Math.max(wordsA.length, 1);
}

function tryParseJSON_(text) {
  // Extract JSON from markdown code fences if present
  var match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  var raw = match ? match[1] : text;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// ---------- Prompt builders ----------

function buildInternalLinksPrompt_(opps, pages) {
  return 'You are an SEO specialist. For each opportunity below, suggest 3 existing pages to add internal links from/to.\n\n'
    + 'Return JSON array: [{opportunity_query, suggestions: [{source_page, target_page, anchor_text}]}]\n\n'
    + 'Opportunities:\n' + JSON.stringify(opps.slice(0, 15)) + '\n\n'
    + 'Available pages:\n' + JSON.stringify(pages.slice(0, 40));
}
