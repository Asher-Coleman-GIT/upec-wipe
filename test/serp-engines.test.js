'use strict';
/**
 * test/serp-engines.test.js
 *
 * serp-watch review, 2026-10-15 (live, dummy person "Jane Doe" "Austin, TX"):
 * html.duckduckgo.com answered 403 with an empty page, read as "no results";
 * Bing's page contains the word "blocked" in its script settings (flagged
 * blocked) and served unrelated results; Google's result links are encrypted
 * redirects. Every month serp-watch said "No new broker domains" without
 * having read anything. Now: DuckDuckGo's main site and Google (visible
 * window), block checks on the visible text only, and an engine whose page
 * cannot be read is reported unreadable, never "nothing found".
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSerp, runSerpScan, blockReason, ENGINES } = require('../lib/serp-scan');

const DDG = (hrefs) => hrefs.map(h => `<article data-testid="result"><a href="${h}" rel="noopener" class="x" data-testid="result-title-a">t</a></article>`).join('');
const GOOGLE = (cites) => `<div id="search">${cites.map(c => `<div><a href="https://www.google.com/goto?url=CAES"><h3>t</h3><cite>${c}</cite></a><cite>${c}</cite></div>`).join('')}</div>`;

test('engines are DuckDuckGo (main site) and Google; Bing is gone', () => {
  assert.deepEqual(ENGINES.map(e => e.id), ['ddg', 'google']);
  assert.match(ENGINES[0].url('"Jane Doe"'), /^https:\/\/duckduckgo\.com\/\?q=/);
});

test('DuckDuckGo results come from the result-title links', () => {
  const r = parseSerp('ddg', DDG(['https://www.spokeo.com/Jane-Doe', 'https://x.example/a?b=1&amp;c=2']));
  assert.deepEqual(r.map(x => x.url), ['https://www.spokeo.com/Jane-Doe', 'https://x.example/a?b=1&c=2']);
  assert.deepEqual(r.map(x => x.rank), [1, 2]);
});

test('Google results come from each result\'s cite line, one per result', () => {
  const r = parseSerp('google', GOOGLE(['https://www.spokeo.com <span>›</span> Jane-Doe', 'https://www.kvue.com · Oct 1, 2026', 'radaris.com › p › Jane']));
  assert.deepEqual(r.map(x => x.url), ['https://www.spokeo.com/', 'https://www.kvue.com/', 'https://radaris.com/']);
  assert.deepEqual(r.map(x => x.rank), [1, 2, 3]);
});

test('block checks read the visible text, not script settings', () => {
  assert.equal(blockReason('Results for Jane Doe ... 12 results'), null);
  assert.match(blockReason('Our systems have detected unusual traffic from your computer network.'), /bot check/);
  assert.match(blockReason("Please confirm you're not a robot"), /bot check/);
});

// Fake browser: one page per engine, chosen by URL.
function ctx(pages) {
  return {
    newPage: async () => {
      const page = {
        _url: null,
        goto: async (u) => { page._url = u; const p = pick(); return { status: () => p.status || 200 }; },
        content: async () => pick().html || '',
        evaluate: async () => pick().text || '',
        close: async () => {},
      };
      const pick = () => pages[Object.keys(pages).find(k => (page._url || '').includes(k))] || {};
      return page;
    },
  };
}
const PERSON = [{ firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Austin', state: 'TX', email: 'j@example.com' }];
const BROKERS = [{ name: 'Spokeo', optOutUrl: 'https://www.spokeo.com/optout' }];
async function scan(pages, opts = {}) {
  const log = console.log; console.log = () => {};
  try { return await runSerpScan(ctx(pages), PERSON, BROKERS, { _skipWrite: true, _noSleep: true, ...opts }); } finally { console.log = log; }
}

test('a 403 page is unreadable, not "nothing found"', async () => {
  const s = await scan({ duckduckgo: { status: 403, html: '<html></html>', text: 'If this persists, please email us.' }, google: { html: GOOGLE(['https://www.spokeo.com › x']), text: 'results' } });
  assert.deepEqual(s.unreadable.map(u => u.engine), ['ddg']);
  assert.match(s.unreadable[0].reason, /HTTP 403/);
  assert.deepEqual(s.read, ['google']);
});

test('a page with no results and no "no results" message is unreadable (layout changed)', async () => {
  const s = await scan({ duckduckgo: { html: '<html><body>new design</body></html>', text: 'new design' }, google: { html: GOOGLE([]), text: 'Your search did not match any documents.' } });
  assert.deepEqual(s.unreadable.map(u => u.engine), ['ddg']);
  assert.deepEqual(s.read, ['google'], 'an honest "no results" page counts as read');
});

test('a bot check without --assist is unreadable; with --assist the member clears it', async () => {
  const blocked = { html: '<html></html>', text: 'Our systems have detected unusual traffic' };
  let s = await scan({ duckduckgo: { html: DDG(['https://www.spokeo.com/J']), text: 'ok' }, google: blocked });
  assert.deepEqual(s.unreadable.map(u => u.engine), ['google']);

  let checks = 0;
  s = await scan({ duckduckgo: { html: DDG(['https://www.spokeo.com/J']), text: 'ok' }, google: blocked }, {
    assist: true, _wait: async (_page, o) => { checks++; assert.match(o.brokerName, /Google/); return false; },
  });
  assert.equal(checks, 1);
  assert.match(s.unreadable[0].reason, /not completed/);
});

test('broker sites are matched on their registrable domain, including catalog sites', async () => {
  const s = await scan({
    duckduckgo: { html: DDG(['https://www.spokeo.com/Jane-Doe', 'https://people.radaris.com/Jane', 'https://unrelated.example/']), text: 'ok' },
    google: { html: GOOGLE(['https://privacy.spokeo.com › x']), text: 'ok' },
  }, { extraBrokers: [{ name: 'radaris.com', optOutUrl: 'https://radaris.com/' }] });
  assert.deepEqual(s.results.map(r => r.hostname).sort(), ['radaris.com', 'spokeo.com']);
  assert.equal(s.results.find(r => r.hostname === 'spokeo.com').ranks.google, 1);
});

test('search-engine hosts never count as broker sites', async () => {
  const s = await scan({ duckduckgo: { html: DDG(['https://support.google.com/x']), text: 'ok' }, google: { html: GOOGLE([]), text: 'did not match any documents' } },
    { extraBrokers: [{ name: 'Google - Results About You', optOutUrl: 'https://myactivity.google.com/results-about-you' }] });
  assert.deepEqual(s.results, []);
});

// Review 2026-10-15 (low): with no city the query was `"Jane Doe" "undefined,
// TX"`; engines found nothing and the report said no broker showed the name.
test('a person with no city is not searched and nothing reads as a clean result', async () => {
  const { buildQuery } = require('../lib/serp-scan');
  assert.equal(buildQuery({ firstName: 'Jane', lastName: 'Doe', state: 'TX' }), null);
  assert.equal(buildQuery({ firstName: 'Ja"ne', lastName: 'Doe', city: 'Exampleton', state: 'TX' }), '"Jane Doe" "Exampleton, TX"');
  let opened = 0;
  const context = { newPage: async () => { opened++; throw new Error('must not search'); } };
  const log = console.log; console.log = () => {};
  let summary;
  try { summary = await runSerpScan(context, [{ firstName: 'Jane', lastName: 'Doe', state: 'TX' }], BROKERS, { _skipWrite: true, _noSleep: true }); } finally { console.log = log; }
  assert.equal(opened, 0);
  assert.deepEqual(summary.read, []);
  assert.match(summary.unreadable.map(u => u.reason).join(' '), /city/);
});
