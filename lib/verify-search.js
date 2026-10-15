'use strict';
/**
 * lib/verify-search.js
 *
 * The search `verify` runs for one broker. Search-form brokers reuse their
 * opt-out search (searchUrl + listingPattern). Direct-form brokers with a
 * public name search carry `verifySearch`:
 *
 *   verifySearch: {
 *     url,           // the name search, built per person in brokers.js
 *     linkPattern,   // the person's own profile link (their name slug)
 *     cardSelector,  // one search result; its text must name the person's city
 *     linkSelector,  // optional: the card's own profile link (not relatives)
 *   }
 *
 * Their searches are fuzzy (USPhonebook's "Jane Doe, TX" lists other names
 * and every result's relatives), so a listing counts only when the card's own
 * link carries the person's name AND the card mentions their city. Without a
 * city there is no match: a name-only guess would report namesakes.
 */

const { checkPageBlockedDetail, BlockedPageError } = require('./block-page');
const { waitForHumanCheck } = require('./assist');
const { jitterSleep } = require('./timing');

/**
 * Runs inside the page (page.evaluate). `doc` is only passed by tests.
 * @returns {string|null} the first own-profile link whose card names the city
 */
function ownListingInPage({ src, flags, linkSelector, cardSelector, city }, doc) {
  const d = doc || document;
  const c = String(city || '').trim().replace(/\s+/g, ' ');
  if (!c) return null;
  const re = new RegExp(src, flags);
  const cityRe = new RegExp(`(^|[^A-Za-z])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}($|[^A-Za-z])`, 'i');
  for (const a of Array.from(d.querySelectorAll(linkSelector || 'a[href]'))) {
    if (!re.test(a.href)) continue;
    const card = a.closest(cardSelector);
    if (card && cityRe.test(card.innerText || '')) return a.href;
  }
  return null;
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
  }

  if (vs) {
    return page.evaluate(ownListingInPage, {
      src: vs.linkPattern.source, flags: vs.linkPattern.flags,
      linkSelector: vs.linkSelector || null, cardSelector: vs.cardSelector, city: person && person.city,
    });
  }
  const links = await page.evaluate(({ src, flags }) => {
    const re = new RegExp(src, flags);
    return Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => re.test(h));
  }, { src: broker.listingPattern.source, flags: broker.listingPattern.flags });
  return (links && links[0]) || null;
}

module.exports = { ownListingInPage, searchListing };
