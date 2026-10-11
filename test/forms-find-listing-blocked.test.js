// test/forms-find-listing-blocked.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.TURBO = '1';
const { findListingUrl } = require('../lib/forms');
const { BlockedPageError } = require('../lib/block-page');

const broker = { searchUrl: 'https://broker.example/search', listingPattern: /broker\.example\/p\//i };
function page({ title = 'Results', text = 'results', status = 200, links = [] } = {}) {
  return {
    goto: async () => ({ status: () => status }),
    title: async () => title,
    evaluate: async (fn, arg) => (arg ? links.filter(h => new RegExp(arg.src, arg.flags).test(h)) : text),
  };
}

test('a matching link is returned', async () => {
  assert.equal(await findListingUrl(page({ links: ['https://broker.example/p/1'] }), broker), 'https://broker.example/p/1');
});
test('a loaded page with no match returns null (genuinely not listed)', async () => {
  assert.equal(await findListingUrl(page({ links: [] }), broker), null);
});
test('a challenge page throws BlockedPageError instead of returning null', async () => {
  await assert.rejects(findListingUrl(page({ title: 'Just a moment...', status: 403 }), broker), BlockedPageError);
});
test('a navigation failure is rethrown', async () => {
  const p = page(); p.goto = async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); };
  await assert.rejects(findListingUrl(p, broker), /ERR_NAME_NOT_RESOLVED/);
});
