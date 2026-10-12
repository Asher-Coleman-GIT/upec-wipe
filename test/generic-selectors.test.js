'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _dismissBanners, _clickDoNotSell } = require('../generic-runner');

function countingPage() {
  const seen = [];
  const self = { first: () => self, count: async () => 0, isVisible: async () => false, click: async () => {} };
  return { seen, locator: (sel) => { seen.push(sel); return self; }, waitForTimeout: async () => {} };
}

test('each selector list is one locator, filtered to visible elements', async () => {
  const p = countingPage();
  await _dismissBanners(p);
  assert.equal(p.seen.length, 1);
  assert.match(p.seen[0], /#onetrust-reject-all-handler.* >> visible=true$/);
  const q = countingPage();
  assert.equal(await _clickDoNotSell(q), false);
  assert.equal(q.seen.length, 1);
  assert.match(q.seen[0], /Do Not Sell.* >> visible=true$/);
});
