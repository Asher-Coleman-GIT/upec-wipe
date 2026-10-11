/**
 * test/brokers-survey-2026-10.test.js
 *
 * Pins brokers.js to the read-only live survey of 2026-10-10 (see
 * docs/superpowers/plans/2026-10-10-broker-reality-check.md).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// brokers.js reads config.json at load time; use the config.example.json values
// by monkeypatching require before importing.
const Module = require('module');
const path = require('path');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './config.json' || request === '../config.json') {
    return require('../config.example.json');
  }
  return origLoad.apply(this, arguments);
};

const brokers = require('../brokers');

Module._load = origLoad;

const REMOVED = ['Radaris', 'PeekYou', 'Nuwber', 'PublicDataUSA', 'ClustrMaps', 'PeopleSmart', 'AnyWho', 'Oracle Data Cloud', 'Intelius', 'TruthFinder', 'InstantCheckmate', 'Equifax (marketing)', 'Experian (marketing)'];
const MANUAL = {
  'PeopleConnect Suppression Center': 'https://suppression.peopleconnect.us/login',
  'OptOutPrescreen (credit bureaus)': 'https://www.optoutprescreen.com/',
  ZoomInfo: 'https://www.zoominfo.com/trust-center/your-privacy',
  Epsilon: 'https://legal.epsilon.com/dsr',
  Acxiom: 'https://www.acxiom.com/optout/',
  LexisNexis: 'https://consumer.risk.lexisnexis.com/opt',
  InfoTracer: 'https://infotracer.com/optout/',
  Clearbit: 'https://clearbit.com/privacy-policy',
  'Addresses.com': 'https://www.addresses.com/',
};
const REPAIRED = {
  FastPeopleSearch: ['#firstname', '#lastname', '#email'],
  USPhonebook: ['#subject-firstname', '#subject-lastname', '#subject-email'],
  PeopleSearchNow: ['#subject-firstname', '#subject-lastname', '#subject-email'],
  SearchPeopleFree: ['#o_first', '#o_last', '#o_email'],
  SocialCatfish: ['#first-name', '#last-name', '#email'],
  PrivateRecords: ['#oo-email'],
};

for (const n of REMOVED) test(`${n} is removed`, () => assert.equal(brokers.find(b => b.name === n), undefined));
for (const [n, url] of Object.entries(MANUAL)) test(`${n} is manual with the live link`, () => {
  const b = brokers.find(x => x.name === n);
  assert.ok(b, n); assert.equal(b.method, 'manual'); assert.equal(b.optOutUrl, url);
  assert.ok((b.notes || '').includes(url), 'notes carry the link so it shows in Action Required');
});
for (const [n, sels] of Object.entries(REPAIRED)) test(`${n} uses the surveyed selectors`, () => {
  const keys = Object.keys(brokers.find(b => b.name === n).formFields);
  for (const s of sels) assert.ok(keys.includes(s), `${n} formFields has ${s}`);
});
test('SocialCatfish never ticks the promotional consent box or the newsletter email', () => {
  const keys = Object.keys(brokers.find(b => b.name === 'SocialCatfish').formFields).join(' ');
  assert.doesNotMatch(keys, /consent|newsletter|name\*=|name="email"/);
});
test('CAPTCHA brokers from the survey ask CapSolver first', () => {
  for (const n of ['FastPeopleSearch', 'USPhonebook', 'PeopleSearchNow', 'SearchPeopleFree', 'SocialCatfish']) {
    assert.equal(brokers.find(b => b.name === n).captchaLikely, true, n);
  }
});
