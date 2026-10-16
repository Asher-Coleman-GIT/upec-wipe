'use strict';
/**
 * lib/verify-search.js
 *
 * The search `verify` runs for one broker, also used by runs for search-form
 * brokers that carry one. Brokers with a public name search carry:
 *
 *   verifySearch: {
 *     url,           // the name search, built per person in brokers.js
 *     cardSelector,  // one search result
 *     linkSelector,  // optional: where the card's profile link is
 *     linkPattern,   // optional: what a profile link looks like
 *     stopAt,        // optional: card text after this (relatives) is ignored
 *   }
 *
 * These searches are fuzzy and list people under aliases (SmartBackgroundChecks:
 * "Karen J Hernandez Almanza ... Also known as Jane Doe"), so a listing is a
 * card whose text names the person (first and last name, middle names
 * allowed) AND their city. Without a city there is no match: a name-only guess
 * would report namesakes. A page with no cards and no "no results" message
 * throws: a changed layout must never read as "clear".
 *
 * Brokers without verifySearch keep the older searchUrl + listingPattern.
 */

const { checkPageBlockedDetail, BlockedPageError } = require('./block-page');
const { waitForHumanCheck } = require('./assist');
const { jitterSleep } = require('./timing');

/**
 * Runs inside the page (page.evaluate). `doc` is only passed by tests.
 * @returns {{ listing: string|null, cards: number, noResults: boolean }}
 *   listing is the matching card's profile link, 'card' when it has none
 */
function ownListingInPage({ cardSelector, linkSelector, linkSrc, linkFlags, stopSrc, stopFlags, first, last, city }, doc) {
  const d = doc || document;
  const esc = (v) => String(v || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const word = (body) => new RegExp(`(^|[^A-Za-z])${body}($|[^A-Za-z])`, 'i');
  const cards = Array.from(d.querySelectorAll(cardSelector));
  const bodyText = (d.body && d.body.innerText) || '';
  const noResults = cards.length === 0 && /\b(no (records|results|matches)|could ?n[o']t find|did not find|0 (results|records|matches))\b/i.test(bodyText);
  if (!String(city || '').trim() || !String(first || '').trim() || !String(last || '').trim()) {
    return { listing: null, cards: cards.length, noResults };
  }
  // First and last name with up to two middle names or initials between.
  const nameRe = word(`${esc(first)}(\\s+[A-Za-z.'-]+){0,2}\\s+${esc(last)}`);
  const cityRe = word(esc(city));
  const stopRe = stopSrc ? new RegExp(stopSrc, stopFlags) : null;
  const linkRe = linkSrc ? new RegExp(linkSrc, linkFlags) : null;
  for (const card of cards) {
    let text = (card.innerText || '').replace(/\s+/g, ' ');
    if (stopRe) { const m = text.search(stopRe); if (m >= 0) text = text.slice(0, m); }
    if (!nameRe.test(text) || !cityRe.test(text)) continue;
    const links = Array.from(card.querySelectorAll(linkSelector || 'a[href]')).filter(a => a.href && (!linkRe || linkRe.test(a.href)));
    return { listing: links.length ? links[0].href : 'card', cards: cards.length, noResults };
  }
  return { listing: null, cards: cards.length, noResults };
}

/**
 * Opens the broker's verify search and reports the person's listing link, or
 * null. A bot check throws BlockedPageError (the broker is then unverifiable,
 * never "clear"); with --assist a solvable one waits for the member first.
 */
async function searchListing(page, broker, person, opts = {}) {
  const check = opts.check || checkPageBlockedDetail;
  const wait = opts.wait || waitForHumanCheck;
  const jitter = opts.jitter || jitterSleep;
  const vs = broker.verifySearch;

  const resp = await page.goto(vs ? vs.url : broker.searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await jitter(1500, 2500);
  const blocked = await check(page, resp);
  if (blocked) {
    const cleared = opts.assist && blocked.solvable && (await wait(page, { brokerName: broker.name }));
    if (!cleared) throw new BlockedPageError(blocked.reason, { solvable: blocked.solvable });
    await jitter(1500, 2500);
  } else {
    // A moved or broken search URL has no listing links either: never "clear".
    // Some brokers answer "nobody by that name here" with a 4xx and their own
    // no-results page (Spokeo); notFoundText recognises that page.
    const status = resp && typeof resp.status === 'function' ? resp.status() : null;
    if (status >= 400) {
      if (vs && vs.notFoundText) {
        const text = await page.evaluate(() => (document.body && document.body.innerText) || '');
        if (vs.notFoundText.test(String(text || ''))) return null;
      }
      throw new Error(`search page answered HTTP ${status}`);
    }
  }

  if (vs) {
    // Results are often drawn by script after the page loads.
    if (typeof page.waitForSelector === 'function') {
      await page.waitForSelector(vs.cardSelector, { timeout: 8000 }).catch(() => {});
    }
    const found = await page.evaluate(ownListingInPage, {
      cardSelector: vs.cardSelector, linkSelector: vs.linkSelector || null,
      linkSrc: vs.linkPattern ? vs.linkPattern.source : null, linkFlags: vs.linkPattern ? vs.linkPattern.flags : '',
      stopSrc: vs.stopAt ? vs.stopAt.source : null, stopFlags: vs.stopAt ? vs.stopAt.flags : '',
      first: person && person.firstName, last: person && person.lastName, city: person && person.city,
    });
    if (found.listing === 'card') return typeof page.url === 'function' ? page.url() : vs.url;
    if (found.listing) return found.listing;
    if (found.cards === 0 && !found.noResults) {
      throw new Error('no result cards found - the page layout may have changed');
    }
    return null;
  }
  const links = await page.evaluate(({ src, flags }) => {
    const re = new RegExp(src, flags);
    return Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => re.test(h));
  }, { src: broker.listingPattern.source, flags: broker.listingPattern.flags });
  return (links && links[0]) || null;
}

module.exports = { ownListingInPage, searchListing };
