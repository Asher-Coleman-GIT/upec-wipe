// test/catalog-sources.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { markupRows, badboolRows, feedRows, buildCandidates } = require('../lib/catalog-sources');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-cat-'));
const write = (n, v) => { const p = path.join(tmp, n); fs.writeFileSync(p, JSON.stringify(v)); return p; };

test('source loaders read the three formats', () => {
  assert.deepEqual(markupRows(write('m.json', [{ name: 'Acme', urlFinal: 'https://www.acme.com/privacy' }, { name: 'Bad', urlFinal: 'ftp://x' }])),
    [{ name: 'Acme', url: 'https://www.acme.com/privacy', source: 'markup' }]);
  assert.deepEqual(badboolRows(write('b.json', ['https://people.example.com/optout'])),
    [{ name: 'people.example.com', url: 'https://people.example.com/optout', source: 'badbool' }]);
  assert.deepEqual(feedRows(write('f.json', [{ name: 'Reg', optOutUrl: 'https://reg.com', source: 'ca', contact: 'p@reg.com' }])),
    [{ name: 'Reg', url: 'https://reg.com', source: 'ca-registry', contact: 'p@reg.com' }]);
});

test('missing source files give no rows', () => {
  assert.deepEqual(markupRows(path.join(tmp, 'none.json')), []);
});

test('candidates merge by registrable domain and keep every source, url and contact', () => {
  const c = buildCandidates({ rows: [
    { name: 'Acme', url: 'https://www.acme.com/privacy', source: 'markup' },
    { name: 'Acme Inc', url: 'https://optout.acme.com/', source: 'ca-registry', contact: 'p@acme.com' },
  ] });
  assert.equal(c.length, 1);
  assert.equal(c[0].domain, 'acme.com');
  assert.equal(c[0].name, 'Acme');
  assert.deepEqual(c[0].sources, ['markup', 'ca-registry']);
  assert.deepEqual(c[0].urls, ['https://www.acme.com/privacy', 'https://optout.acme.com/']);
  assert.deepEqual(c[0].contacts, ['p@acme.com']);
});

test('explicit brokers, dead hosts and bare public suffixes are dropped', () => {
  const c = buildCandidates({
    rows: [
      { name: 'S', url: 'https://members.searchquarry.com/x', source: 'badbool' },
      { name: 'D', url: 'https://dead.example.org/', source: 'markup' },
      { name: 'U', url: 'https://co.uk/', source: 'markup' },
      { name: 'K', url: 'https://keep.example.net/', source: 'markup' },
    ],
    explicitHosts: new Set(['searchquarry.com']),
    deadHosts: new Set(['dead.example.org']),
  });
  assert.deepEqual(c.map(x => x.domain), ['example.net']);
});

test('a broker under a two-label suffix keeps its own domain', () => {
  const c = buildCandidates({ rows: [{ name: 'U', url: 'https://www.broker.co.uk/optout', source: 'markup' }] });
  assert.deepEqual(c.map(x => x.domain), ['broker.co.uk']);
});

test('http urls are upgraded to https', () => {
  const c = buildCandidates({ rows: [{ name: 'H', url: 'http://h.example.com/a', source: 'markup' }] });
  assert.deepEqual(c[0].urls, ['https://h.example.com/a']);
});

test('a trailing dot in a host (BADBOOL "https://optout.aboutads.info.") does not make a bogus domain', () => {
  const c = buildCandidates({ rows: [{ name: 'A', url: 'https://optout.aboutads.info.', source: 'badbool' }] });
  assert.deepEqual(c.map(x => x.domain), ['aboutads.info']);
});

test('a registry "website" that is a word, not a host, is dropped', () => {
  const c = buildCandidates({ rows: [{ name: 'X', url: 'https://GLBA', source: 'ca-registry' }, { name: 'Y', url: 'https://non-profit', source: 'ca-registry' }] });
  assert.deepEqual(c, []);
});
