#!/usr/bin/env node
/**
 * scripts/inspect-search-results.js - read-only survey of broker name-search
 * result pages, for `verify` (brokers.js verifySearch).
 *
 * Read-only. Uses the dummy person (Jane Doe, Austin TX). Never clicks or
 * submits. For each search page it records where the result links point and
 * the elements around them, so a verifySearch linkPattern / cardSelector can be
 * written from facts.
 *
 *   ASSIST=1 node scripts/inspect-search-results.js            (all candidates)
 *   ASSIST=1 node scripts/inspect-search-results.js ThatsThem   (one)
 *     (visible window; when a site shows a bot check, complete it and the
 *      survey carries on)
 *
 * Output: one JSON file per page in logs/search-survey/ (gitignored), or in
 * SURVEY_OUT when set.
 */
'use strict';
process.umask(0o077);
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadChromium } = require(path.join(ROOT, 'lib/playwright-loader'));
const { buildLaunchOptions } = require(path.join(ROOT, 'lib/browser'));
const { buildStealthScript } = require(path.join(ROOT, 'lib/stealth'));
const { ensureNodeEgress } = require(path.join(ROOT, 'lib/egress'));
const { checkPageBlockedDetail } = require(path.join(ROOT, 'lib/block-page'));
const { waitForHumanCheck } = require(path.join(ROOT, 'lib/assist'));
const ASSIST = process.env.ASSIST === '1';
const OUT = process.env.SURVEY_OUT ? path.resolve(process.env.SURVEY_OUT) : path.join(ROOT, 'logs', 'search-survey');

// Candidate name searches for the dummy person. Brokers that already have a
// search URL in brokers.js are surveyed at that URL.
const CANDIDATES = {
  TruePeopleSearch: ['https://www.truepeoplesearch.com/results?name=Jane%20Doe&citystatezip=Austin%2C%20TX'],
  FastPeopleSearch: ['https://www.fastpeoplesearch.com/name/jane-doe_austin-tx'],
  SmartBackgroundChecks: ['https://www.smartbackgroundchecks.com/people/jane-doe/austin/tx'],
  SearchPeopleFree: ['https://www.searchpeoplefree.com/find/jane-doe/tx/austin'],
  ThatsThem: ['https://thatsthem.com/name/Jane-Doe/Austin-TX'],
  PeopleSearchNow: ['https://www.peoplesearchnow.com/person/jane-doe_austin_tx'],
  Spokeo: ['https://www.spokeo.com/Jane-Doe/Texas/Austin'],
  // The brokers.js MyLife search answered 404 on 2026-10-15.
  MyLife: [
    'https://www.mylife.com/jane-doe/',
    'https://www.mylife.com/pub-multisearch.pubview?searchFirstName=Jane&searchLastName=Doe&searchLocation=Austin%2C%20TX',
    'https://www.mylife.com/',
  ],
};
const DUMMY = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', state: 'TX', city: 'Austin', zip: '73301', email: 'jane@example.com', country: 'US' };
for (const b of require(path.join(ROOT, 'brokers')).forPerson(DUMMY)) {
  if (b.searchUrl && b.method === 'search-form' && !CANDIDATES[b.name]) CANDIDATES[b.name] = [b.searchUrl];
}

// In the page: result cards that name the dummy person (in a link or only in
// the card text: some sites link "View Details" or list people under aliases),
// with the elements around each card's links.
function describeResults() {
  const named = (s) => /jane\b[\s\S]{0,40}?\bdoe\b/i.test(s || '');
  const out = [];
  const cards = new Set();
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    // The smallest ancestor (up to 8 levels) whose text names the person and
    // looks like one result: short enough not to be the whole list.
    let card = null;
    let el = a;
    for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
      const len = (el.innerText || '').length;
      if (len > 1500) break;
      if (named(el.innerText) || named(a.href)) { card = el; break; }
    }
    if (!card || cards.has(card)) continue;
    cards.add(card);
    const chain = [];
    for (let i = 0, e = a; i < 8 && e; i++, e = e.parentElement) {
      chain.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${Array.from(e.classList).slice(0, 4).map(c => '.' + c).join('')} len=${(e.innerText || '').length}`);
    }
    const links = Array.from(card.querySelectorAll('a[href]')).slice(0, 6).map(x => ({ href: x.href, text: (x.textContent || '').trim().slice(0, 40), cls: x.className && String(x.className).slice(0, 60) }));
    out.push({ href: a.href, text: (a.textContent || '').trim().slice(0, 60), chain, card: (card.innerText || '').replace(/\s+/g, ' ').slice(0, 300), links });
    if (out.length >= 15) break;
  }
  return out;
}

(async () => {
  // Same rule as a run: nothing leaves this machine unless it goes out via Mullvad.
  await ensureNodeEgress({ network: { required: true } });
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const only = process.argv.slice(2);
  const targets = Object.entries(CANDIDATES).filter(([name]) => !only.length || only.includes(name));
  const browser = await loadChromium().launch(buildLaunchOptions({ headless: process.env.HEADED !== '1' && !ASSIST }));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(buildStealthScript()).catch(() => {});
  for (const [name, urls] of targets) {
    for (const [i, url] of urls.entries()) {
      const page = await ctx.newPage();
      const out = { name, url, at: new Date().toISOString() };
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        out.status = resp ? resp.status() : null;
        let blocked = await checkPageBlockedDetail(page, resp);
        if (blocked && blocked.solvable && ASSIST) {
          out.assisted = await waitForHumanCheck(page, { brokerName: name });
          blocked = await checkPageBlockedDetail(page, null);
        }
        out.blocked = blocked ? blocked.reason : null;
        await page.waitForTimeout(Number(process.env.WAIT || 5000));
        out.finalUrl = page.url();
        out.title = await page.title();
        out.text = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 1200);
        out.results = await page.evaluate(describeResults);
      } catch (e) {
        out.error = String(e.message).split('\n')[0];
      }
      const file = `${name.replace(/[^\w.-]+/g, '_')}${urls.length > 1 ? '-' + (i + 1) : ''}.json`;
      fs.writeFileSync(path.join(OUT, file), JSON.stringify(out, null, 1), { mode: 0o600 });
      console.log(`${name.padEnd(24)} ${String(out.status || '-').padEnd(4)} results=${(out.results || []).length} ${out.blocked || out.error || ''}`);
      await page.close();
    }
  }
  await browser.close();
  console.log(`\nSaved to ${OUT}`);
})().catch(e => { console.error(e.message); process.exit(1); });
