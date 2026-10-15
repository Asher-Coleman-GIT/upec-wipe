'use strict';
/**
 * test/verify-search.test.js
 *
 * verify for direct-form brokers (2026-10-15). Their public name search is
 * fuzzy: USPhonebook's "Jane Doe, TX" page lists other names and every
 * result's relatives as profile links. A listing counts only when the result
 * card's own profile link carries the person's name AND the card mentions the
 * person's city. Bot checks wait for the member with --assist.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ownListingInPage, searchListing } = require('../lib/verify-search');
const { BlockedPageError } = require('../lib/block-page');

// Fake DOM: result cards with text and links.
function card(text, links = []) {
  return { innerText: text, querySelectorAll: (sel) => links.filter(l => l.selectors.includes(sel) || sel === 'a[href]') };
}
function link(href, selectors = ['a.btn']) { return { href, selectors }; }
function fakeDoc(cards, bodyText = '') {
  return { querySelectorAll: (sel) => (sel === '.card' ? cards : []), body: { innerText: bodyText } };
}
const args = (city, extra = {}) => ({ cardSelector: '.card', linkSelector: 'a.btn', linkSrc: null, linkFlags: '', stopSrc: null, stopFlags: '', first: 'Jane', last: 'Doe', city, ...extra });

test('a card naming the person and their city is a listing, with its profile link', () => {
  const doc = fakeDoc([
    card('Deborah Foust, Age 49 Lives in: Austin, TX', [link('https://b.example/deborah-foust/U2')]),
    card('Jane Marie Doe, Age 40 Lives in: Austin, TX', [link('https://b.example/jane-doe/U1')]),
  ]);
  assert.deepEqual(ownListingInPage(args('Austin'), doc), { listing: 'https://b.example/jane-doe/U1', cards: 2, noResults: false });
});

test('an alias counts (SmartBackgroundChecks, Spokeo list people under other names)', () => {
  const doc = fakeDoc([card('Karen J Hernandez Almanza Age 33 - Austin, TX Also known as Jane Doe', [link('https://b.example/people/karen-almanza/E1')])]);
  assert.equal(ownListingInPage(args('Austin'), doc).listing, 'https://b.example/people/karen-almanza/E1');
});

test('a namesake in another city is not a listing', () => {
  const doc = fakeDoc([card('Jane Doe, Lives in: Lumberton, TX Prior addresses: Vidor, TX', [link('https://b.example/jane-doe/U1')])]);
  assert.equal(ownListingInPage(args('Austin'), doc).listing, null);
});

test('city and name match as whole words, any case', () => {
  assert.equal(ownListingInPage(args('Austin'), fakeDoc([card('Jane Doe, Lives in: Austintown, OH', [link('https://b.example/1')])])).listing, null);
  assert.equal(ownListingInPage(args('Austin'), fakeDoc([card('Janet Doe, Austin TX', [link('https://b.example/1')])])).listing, null);
  assert.equal(ownListingInPage(args('Austin'), fakeDoc([card('Jane Doelling, Austin TX', [link('https://b.example/1')])])).listing, null);
  assert.equal(ownListingInPage(args('north exampleton'), fakeDoc([card('JANE A DOE - North  Exampleton, TX', [link('https://b.example/1')])])).listing, 'https://b.example/1');
});

test('names after the stop marker (relatives) are ignored', () => {
  const doc = fakeDoc([card('Christine Grimes, Lives in: Austin, TX Relatives: Jane Doe, Amy Grimes', [link('https://b.example/christine-grimes/U3')])]);
  assert.equal(ownListingInPage(args('Austin', { stopSrc: '\\bRelatives?\\b', stopFlags: 'i' }), doc).listing, null);
});

test('only links matching linkPattern are taken as the profile link; none falls back to the page', () => {
  const doc = fakeDoc([card('Jane Doe, Austin TX', [link('https://b.example/ads/1'), link('https://b.example/find/person/p1')])]);
  assert.equal(ownListingInPage(args('Austin', { linkSrc: '/find/person/', linkFlags: 'i' }), doc).listing, 'https://b.example/find/person/p1');
  const bare = fakeDoc([card('Jane Doe, Austin TX', [])]);
  assert.equal(ownListingInPage(args('Austin'), bare).listing, 'card');
});

test('no city means no match (never a name-only guess)', () => {
  const doc = fakeDoc([card('Jane Doe, Lives in: Austin, TX', [link('https://b.example/jane-doe/U1')])]);
  assert.equal(ownListingInPage(args(''), doc).listing, null);
});

test('a page with no cards reports whether it says "no results"', () => {
  assert.deepEqual(ownListingInPage(args('Austin'), fakeDoc([], 'Sorry, we could not find any records for Jane Doe')), { listing: null, cards: 0, noResults: true });
  assert.deepEqual(ownListingInPage(args('Austin'), fakeDoc([], 'Welcome to our redesigned site')), { listing: null, cards: 0, noResults: false });
});

// searchListing: navigation, bot checks, and which matcher runs.
function page({ status = 200, found = null, url = 'https://www.usphonebook.com/jane-doe/texas' } = {}) {
  const calls = { goto: [], evaluate: 0 };
  return {
    calls,
    url: () => url,
    goto: async (u) => { calls.goto.push(u); return { status: () => status }; },
    evaluate: async () => { calls.evaluate++; return found; },
  };
}
const VS_BROKER = { name: 'USPhonebook', verifySearch: { url: 'https://www.usphonebook.com/jane-doe/texas', cardSelector: '.card', linkSelector: 'a.btn' } };
const PERSON = { firstName: 'Jane', lastName: 'Doe', city: 'Austin', state: 'TX' };
const noSleep = { jitter: async () => {} };
const hit = (listing, cards = 3, noResults = false) => ({ listing, cards, noResults });

test('searchListing opens the verify search URL and returns the card match', async () => {
  const p = page({ found: hit('https://www.usphonebook.com/jane-doe/UkTN3') });
  const url = await searchListing(p, VS_BROKER, PERSON, { ...noSleep, check: async () => null });
  assert.equal(url, 'https://www.usphonebook.com/jane-doe/UkTN3');
  assert.deepEqual(p.calls.goto, ['https://www.usphonebook.com/jane-doe/texas']);
});

test('a matching card without a profile link reports the results page', async () => {
  const p = page({ found: hit('card'), url: 'https://www.usphonebook.com/jane-doe/texas?x=1' });
  assert.equal(await searchListing(p, VS_BROKER, PERSON, { ...noSleep, check: async () => null }), 'https://www.usphonebook.com/jane-doe/texas?x=1');
});

test('cards but no match is "not listed"', async () => {
  assert.equal(await searchListing(page({ found: hit(null, 5) }), VS_BROKER, PERSON, { ...noSleep, check: async () => null }), null);
});

test('no cards and a "no results" message is "not listed"', async () => {
  assert.equal(await searchListing(page({ found: hit(null, 0, true) }), VS_BROKER, PERSON, { ...noSleep, check: async () => null }), null);
});

test('no cards and no "no results" message throws: the layout changed, never "clear"', async () => {
  await assert.rejects(searchListing(page({ found: hit(null, 0, false) }), VS_BROKER, PERSON, { ...noSleep, check: async () => null }), /no result cards/);
});

test('a bot check without --assist throws (unverifiable, never "clear")', async () => {
  const p = page();
  await assert.rejects(
    searchListing(p, VS_BROKER, PERSON, { ...noSleep, assist: false, check: async () => ({ reason: 'blocked by bot protection', solvable: true }) }),
    BlockedPageError);
  assert.equal(p.calls.evaluate, 0);
});

test('a bot check with --assist waits for the member, then reads the page', async () => {
  const p = page({ found: hit(null, 4) });
  let waited = 0;
  const url = await searchListing(p, VS_BROKER, PERSON, {
    ...noSleep, assist: true,
    check: async () => ({ reason: 'blocked by bot protection', solvable: true }),
    wait: async () => { waited++; return true; },
  });
  assert.equal(url, null);
  assert.equal(waited, 1);
  assert.equal(p.calls.evaluate, 1);
});

test('a bot check not completed in time throws', async () => {
  const p = page();
  await assert.rejects(
    searchListing(p, VS_BROKER, PERSON, { ...noSleep, assist: true, check: async () => ({ reason: 'x', solvable: true }), wait: async () => false }),
    BlockedPageError);
});

test('a hard block with --assist does not wait', async () => {
  let waited = 0;
  await assert.rejects(
    searchListing(page(), VS_BROKER, PERSON, { ...noSleep, assist: true, check: async () => ({ reason: 'blocked (HTTP 403)', solvable: false }), wait: async () => { waited++; return true; } }),
    BlockedPageError);
  assert.equal(waited, 0);
});

test('a verify search page answering 404 throws (unverifiable, never "clear")', async () => {
  const p = page({ status: 404 });
  await assert.rejects(searchListing(p, VS_BROKER, PERSON, { ...noSleep, check: async () => null }), /HTTP 404/);
  assert.equal(p.calls.evaluate, 0);
});

test('a search-form broker without verifySearch keeps its searchUrl and listingPattern', async () => {
  const p = page({ found: ['https://x.example/Jane-Doe/p123'] });
  const url = await searchListing(p, { name: 'X', searchUrl: 'https://x.example/search?q=Jane', listingPattern: /x\.example/i }, PERSON, { ...noSleep, check: async () => null });
  assert.deepEqual(p.calls.goto, ['https://x.example/search?q=Jane']);
  assert.equal(url, 'https://x.example/Jane-Doe/p123');
});

// Broker entries, surveyed 2026-10-15 with the dummy person.
const DUMMY = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', state: 'TX', city: 'North Exampleton', country: 'US' };
const byName = (n) => require('../brokers').forPerson(DUMMY).find(x => x.name === n);

test('verifySearch entries: URLs built from the person, every card selector set', () => {
  const want = {
    USPhonebook: 'https://www.usphonebook.com/jane-doe/texas',
    TruePeopleSearch: 'https://www.truepeoplesearch.com/results?name=Jane%20Doe&citystatezip=North%20Exampleton%2C%20TX',
    SmartBackgroundChecks: 'https://www.smartbackgroundchecks.com/people/jane-doe/north-exampleton/tx',
    Spokeo: 'https://www.spokeo.com/Jane-Doe/Texas/North-Exampleton',
  };
  for (const [name, url] of Object.entries(want)) {
    const vs = byName(name).verifySearch;
    assert.equal(vs.url, url, name);
    assert.ok(vs.cardSelector, name);
  }
  assert.equal(byName('USPhonebook').method, 'direct-form', 'opting out stays a direct form');
});

test('Spokeo profile links are /First-Last/State/City/p<digits> (the old pattern wanted "-p")', () => {
  const re = byName('Spokeo').verifySearch.linkPattern;
  assert.ok(re.test('https://www.spokeo.com/Jane-Doe/Texas/Austin/p40097990292'));
  assert.ok(!re.test('https://www.spokeo.com/Jane-Doe/Texas/Austin--San-Marcos-Metro'));
});

test('MyLife is manual: its search ignores location, so a far-down listing would read as "clear"', () => {
  const b = byName('MyLife');
  assert.equal(b.method, 'manual');
  assert.equal(b.verifySearch, undefined);
  assert.match(b.notes, /mylife\.com/);
});
