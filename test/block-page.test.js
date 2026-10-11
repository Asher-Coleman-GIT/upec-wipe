// test/block-page.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectBlockPage, BlockedPageError, checkPageBlocked } = require('../lib/block-page');

test('Cloudflare interstitial is a block page', () => {
  assert.match(detectBlockPage({ status: 403, title: 'Just a moment...', text: 'Performing security verification' }), /bot protection/);
});
test('Cloudflare hard block is a block page', () => {
  assert.ok(detectBlockPage({ status: 403, title: 'Attention Required! | Cloudflare', text: 'Sorry, you have been blocked' }));
  assert.ok(detectBlockPage({ status: 403, title: 'Access denied | x.com used Cloudflare to restrict access', text: 'Error 1005' }));
});
test('200 challenge page is still a block page', () => {
  assert.ok(detectBlockPage({ status: 200, title: '', text: 'Are you human? You are accessing a page that needs extra human verification' }));
  assert.ok(detectBlockPage({ status: 200, title: 'Checking your browser', text: '' }));
  assert.ok(detectBlockPage({ status: 403, title: 'Access to this page has been denied', text: 'Press & Hold to confirm you are a human' }));
});
test('a normal opt-out page is not a block page', () => {
  assert.equal(detectBlockPage({ status: 200, title: 'Opt-Out Request Start - FastPeopleSearch', text: 'First Name Last Name Email' }), null);
});
test('a plain 403 with no challenge text is still treated as blocked', () => {
  assert.match(detectBlockPage({ status: 403, title: 'Forbidden', text: '' }), /HTTP 403/);
});
test('BlockedPageError carries the reason', () => {
  const e = new BlockedPageError('blocked by bot protection');
  assert.equal(e.reason, 'blocked by bot protection');
  assert.equal(e.name, 'BlockedPageError');
});
test('checkPageBlocked reads title and text from the page', async () => {
  const page = { title: async () => 'Just a moment...', evaluate: async () => 'Performing security verification' };
  assert.ok(await checkPageBlocked(page, { status: () => 403 }));
  const ok = { title: async () => 'Opt out', evaluate: async () => 'Email' };
  assert.equal(await checkPageBlocked(ok, { status: () => 200 }), null);
  assert.equal(await checkPageBlocked(ok, null), null, 'no response object (same-document nav) is fine');
});
test('checkPageBlocked fails safe when the page cannot report title or text', async () => {
  const bare = {};
  assert.equal(await checkPageBlocked(bare, { status: () => 200 }), null);
  const throwing = { title: () => { throw new Error('closed'); }, evaluate: () => { throw new Error('closed'); } };
  assert.equal(await checkPageBlocked(throwing, { status: () => 200 }), null);
});

// --assist: a person can clear a challenge, but not a hard block.
test('challenge pages are solvable by a person', () => {
  const { isSolvableChallenge } = require('../lib/block-page');
  for (const p of [
    { title: 'Just a moment...', text: '' },
    { title: '', text: 'Performing security verification' },
    { title: 'Checking your browser', text: '' },
    { title: '', text: 'Are you human? You are accessing a page that needs extra human verification' },
    { title: 'Access to this page has been denied', text: 'Press & Hold to confirm you are a human' },
    { title: 'Just a moment...', text: 'Please complete the security challenge' },
  ]) assert.equal(isSolvableChallenge(p), true, JSON.stringify(p));
});
test('hard blocks are not solvable by a person', () => {
  const { isSolvableChallenge } = require('../lib/block-page');
  assert.equal(isSolvableChallenge({ title: 'Attention Required! | Cloudflare', text: 'Sorry, you have been blocked' }), false);
  assert.equal(isSolvableChallenge({ title: 'Access denied | checkpeople.com used Cloudflare to restrict access', text: 'Error 1005' }), false);
  assert.equal(isSolvableChallenge({ status: 403, title: 'Forbidden', text: '' }), false);
});
test('checkPageBlockedDetail reports reason and solvability', async () => {
  const { checkPageBlockedDetail } = require('../lib/block-page');
  const challenge = { title: async () => 'Just a moment...', evaluate: async () => '' };
  assert.deepEqual(await checkPageBlockedDetail(challenge, { status: () => 403 }), { reason: 'blocked by bot protection', solvable: true });
  const hard = { title: async () => 'Attention Required! | Cloudflare', evaluate: async () => 'Sorry, you have been blocked' };
  assert.deepEqual(await checkPageBlockedDetail(hard, { status: () => 403 }), { reason: 'blocked by bot protection', solvable: false });
  const ok = { title: async () => 'Opt out', evaluate: async () => 'Email' };
  assert.equal(await checkPageBlockedDetail(ok, { status: () => 200 }), null);
});
test('BlockedPageError carries solvability', () => {
  assert.equal(new BlockedPageError('x', { solvable: true }).solvable, true);
  assert.equal(new BlockedPageError('x').solvable, false);
});
