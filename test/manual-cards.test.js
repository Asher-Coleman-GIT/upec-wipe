/**
 * test/manual-cards.test.js
 *
 * `upec-wipe manual` prints numbered cards, grouped like `list` (brokers, then
 * catalog sites): the instructions wrapped, each link on its own line.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitDetail, formatManual } = require('../lib/manual');

test('a trailing link moves to its own line with its lead-in', () => {
  assert.deepEqual(splitDetail('the CAPTCHA could not be solved - do it by hand: https://a.example/opt'),
    { text: 'The CAPTCHA could not be solved - do it by hand.', links: ['https://a.example/opt'] });
  assert.deepEqual(splitDetail('Multi-step request portal: https://b.example/opt'),
    { text: 'Multi-step request portal.', links: ['https://b.example/opt'] });
  assert.deepEqual(splitDetail('Look for an opt-out link at https://c.example/'),
    { text: 'Look for an opt-out link.', links: ['https://c.example/'] });
});

test('a link in mid-sentence reads "the link below"', () => {
  assert.deepEqual(splitDetail('Search your name at https://d.example/search, pick your own record, then confirm.'),
    { text: 'Search your name at the link below, pick your own record, then confirm.', links: ['https://d.example/search'] });
});

test('two different links are labelled, a repeated one keeps its label', () => {
  assert.deepEqual(
    splitDetail('you are listed at https://e.example/p/1 - request removal at https://e.example/opt (see https://e.example/opt)'),
    { text: 'You are listed at link 1 - request removal at link 2 (see link 2).',
      links: ['link 1: https://e.example/p/1', 'link 2: https://e.example/opt'] });
});

test('a bare link, or nothing at all', () => {
  assert.deepEqual(splitDetail('https://f.example/opt'), { text: '', links: ['https://f.example/opt'] });
  assert.deepEqual(splitDetail(''), { text: '(no link recorded)', links: [] });
});

test('no extra full stop after a sentence that closes a parenthesis', () => {
  assert.equal(splitDetail('Do it at https://j.example/a (then check https://j.example/b.)').text,
    'Do it at link 1 (then check link 2.)');
});

const E = (name, since, detail) => ({ key: name, name, person: '', since, detail });

test('cards are grouped, numbered across groups, wrapped, with the date once per group', () => {
  const out = formatManual([
    E('Hand Catalog Site', '2026-10-14T09:00:00Z', 'https://g.example/opt'),
    E('Main Broker', '2026-10-14T09:00:00Z',
      'Search your name and state at https://h.example/search, pick your own record from the results, then confirm with your alias email.'),
  ], { brokerNames: new Set(['Main Broker']), width: 50 });
  assert.equal(out, [
    '2 sites to finish by hand',
    '',
    'Brokers (1) - listed 2026-10-14',
    '-'.repeat(50),
    '1. Main Broker',
    '   Search your name and state at the link below,',
    '   pick your own record from the results, then',
    '   confirm with your alias email.',
    '   https://h.example/search',
    '',
    'Catalog sites (1) - listed 2026-10-14',
    '-'.repeat(50),
    '2. Hand Catalog Site',
    '   https://g.example/opt',
    '',
    'When you finish one: upec-wipe done "<name>" (several names at once work too)',
  ].join('\n'));
});

test('mixed dates go on each card; a person shows after the name; long links are never broken', () => {
  const long = 'https://i.example/' + 'x'.repeat(80);
  const out = formatManual([
    { key: 'B|Jane Doe', name: 'B', person: 'Jane Doe', since: '2026-10-01T00:00:00Z', detail: long },
    E('C', '2026-10-14T00:00:00Z', 'Do it.'),
  ], { brokerNames: new Set(), width: 40 });
  assert.match(out, /^Catalog sites \(2\)$/m);
  assert.match(out, /^1\. B \(Jane Doe\) - listed 2026-10-01$/m);
  assert.match(out, /^2\. C - listed 2026-10-14$/m);
  assert.ok(out.includes(`   ${long}\n`));
});

test('a card whose text has no link shows the broker page from urlFor', () => {
  const out = formatManual([E('Search Giant', '2026-10-14T00:00:00Z', 'Use "Results about you" to flag address/phone in search results')],
    { brokerNames: new Set(['Search Giant']), width: 80, urlFor: (n) => (n === 'Search Giant' ? 'https://k.example/results' : null) });
  assert.match(out, /^ {3}Use "Results about you" to flag address\/phone in search results\.\n {3}https:\/\/k\.example\/results$/m);
});

// Spawned in a config-free copy of the repo, with a dummy state file.
const { makeFixtureRepo, runIn } = require('./helpers/fixture-repo');
const FIXTURE = makeFixtureRepo();
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));

test('upec-wipe manual prints the cards', () => {
  const statePath = path.join(FIXTURE, 'state.test.json');
  fs.writeFileSync(statePath, JSON.stringify({ optOuts: {
    BeenVerified: { manual: { since: '2026-10-14T00:00:00Z', detail: 'Search your name and state at https://www.beenverified.com/app/optout/search, pick your record.' } },
  } }));
  const r = runIn(FIXTURE, 'bin/upec-wipe.js', ['manual'], { statePath });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, out);
  assert.match(out, /^1 site to finish by hand$/m);
  assert.match(out, /^Brokers \(1\) - listed 2026-10-14$/m);
  assert.match(out, /^1\. BeenVerified$/m);
  assert.match(out, /^ {3}https:\/\/www\.beenverified\.com\/app\/optout\/search$/m);
});
