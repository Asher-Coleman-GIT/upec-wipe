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

// Fake DOM: each anchor knows its card (closest(cardSelector)) and whether it
// matches linkSelector.
function fakeDoc(anchors) {
  return {
    querySelectorAll: (sel) => anchors.filter(a => a.selectors.includes(sel)),
  };
}
function anchor(href, cardText, selectors = ['a.btn']) {
  return { href, selectors, closest: (sel) => (sel === '.card' && cardText != null ? { innerText: cardText } : null) };
}
const PATTERN = /usphonebook\.com\/jane-doe\/U[A-Za-z0-9]+$/i;
const args = (city, extra = {}) => ({ src: PATTERN.source, flags: PATTERN.flags, linkSelector: 'a.btn', cardSelector: '.card', city, ...extra });

test('a result card with the name link and the city is a listing', () => {
  const doc = fakeDoc([
    anchor('https://www.usphonebook.com/deborah-foust/U2MTM', 'Deborah Foust, Lives in: Austin, TX'),
    anchor('https://www.usphonebook.com/jane-doe/UkTN3', 'Jane Marie Doe, Age 40 Lives in: Austin, TX'),
  ]);
  assert.equal(ownListingInPage(args('Austin'), doc), 'https://www.usphonebook.com/jane-doe/UkTN3');
});

test('a namesake in another city is not a listing', () => {
  const doc = fakeDoc([anchor('https://www.usphonebook.com/jane-doe/UkTN3', 'Jane Doe, Lives in: Lumberton, TX Prior addresses: Vidor, TX')]);
  assert.equal(ownListingInPage(args('Austin'), doc), null);
});

test('the city must match as a whole word, any case', () => {
  const doc = fakeDoc([anchor('https://www.usphonebook.com/jane-doe/UkTN3', 'Jane Doe, Lives in: Austintown, OH')]);
  assert.equal(ownListingInPage(args('Austin'), doc), null);
  const doc2 = fakeDoc([anchor('https://www.usphonebook.com/jane-doe/UkTN3', 'Jane Doe, Prior addresses: AUSTIN, TX')]);
  assert.equal(ownListingInPage(args('austin'), doc2), 'https://www.usphonebook.com/jane-doe/UkTN3');
});

test('a relative link inside a card (not the card button) is ignored', () => {
  const doc = fakeDoc([anchor('https://www.usphonebook.com/jane-doe/UkTN3', 'Christine Grimes, Lives in: Austin, TX Relatives: Jane Doe', ['a'])]);
  assert.equal(ownListingInPage(args('Austin'), doc), null);
});

test('a link outside any result card is ignored', () => {
  const doc = fakeDoc([anchor('https://www.usphonebook.com/jane-doe/UkTN3', null)]);
  assert.equal(ownListingInPage(args('Austin'), doc), null);
});

test('no city means no match (never a name-only guess)', () => {
  const doc = fakeDoc([anchor('https://www.usphonebook.com/jane-doe/UkTN3', 'Jane Doe, Lives in: Austin, TX')]);
  assert.equal(ownListingInPage(args(''), doc), null);
});

// searchListing: navigation, bot checks, and which matcher runs.
function page({ status = 200, found = null } = {}) {
  const calls = { goto: [], evaluate: 0 };
  return {
    calls,
    goto: async (url) => { calls.goto.push(url); return { status: () => status }; },
    evaluate: async () => { calls.evaluate++; return found; },
  };
}
const VS_BROKER = { name: 'USPhonebook', verifySearch: { url: 'https://www.usphonebook.com/jane-doe/texas', linkPattern: PATTERN, linkSelector: 'a.btn', cardSelector: '.card' } };
const PERSON = { firstName: 'Jane', lastName: 'Doe', city: 'Austin', state: 'TX' };
const noSleep = { jitter: async () => {} };

test('searchListing opens the verify search URL and returns the card match', async () => {
  const p = page({ found: 'https://www.usphonebook.com/jane-doe/UkTN3' });
  const url = await searchListing(p, VS_BROKER, PERSON, { ...noSleep, check: async () => null });
  assert.equal(url, 'https://www.usphonebook.com/jane-doe/UkTN3');
  assert.deepEqual(p.calls.goto, ['https://www.usphonebook.com/jane-doe/texas']);
});

test('a bot check without --assist throws (unverifiable, never "clear")', async () => {
  const p = page();
  await assert.rejects(
    searchListing(p, VS_BROKER, PERSON, { ...noSleep, assist: false, check: async () => ({ reason: 'blocked by bot protection', solvable: true }) }),
    BlockedPageError);
  assert.equal(p.calls.evaluate, 0);
});

test('a bot check with --assist waits for the member, then reads the page', async () => {
  const p = page({ found: null });
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

test('a search-form broker without verifySearch keeps its searchUrl and listingPattern', async () => {
  const p = page({ found: ['https://www.spokeo.com/Jane-Doe/Texas/Austin/p123'] });
  const url = await searchListing(p, { name: 'Spokeo', searchUrl: 'https://www.spokeo.com/search?q=Jane', listingPattern: /spokeo/i }, PERSON, { ...noSleep, check: async () => null });
  assert.deepEqual(p.calls.goto, ['https://www.spokeo.com/search?q=Jane']);
  assert.equal(url, 'https://www.spokeo.com/Jane-Doe/Texas/Austin/p123');
});

test('USPhonebook carries a verifySearch built from the person', () => {
  const list = require('../brokers').forPerson({ firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', state: 'TX', city: 'Austin', country: 'US' });
  const b = list.find(x => x.name === 'USPhonebook');
  assert.equal(b.method, 'direct-form', 'opting out stays a direct form');
  assert.equal(b.verifySearch.url, 'https://www.usphonebook.com/jane-doe/texas');
  const re = b.verifySearch.linkPattern;
  assert.ok(re.test('https://www.usphonebook.com/jane-doe/UkTNyQjM3EjN5EzR'));
  assert.ok(!re.test('https://www.usphonebook.com/janet-doe/UkTNyQjM3EjN5EzR'));
  assert.ok(!re.test('https://www.usphonebook.com/jane-doe/texas?page=2'));
  assert.ok(!re.test('https://www.usphonebook.com/mary-jane-doe/UkTNyQjM3EjN5EzR'));
  assert.equal(b.verifySearch.cardSelector, '.ls_contacts-people-finder-wrapper');
});
