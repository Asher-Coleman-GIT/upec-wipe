'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hostnameOf, registrableDomain } = require('../lib/domain');

test('the domain helpers live in lib/domain; serp-scan re-exports the same functions', () => {
  const serp = require('../lib/serp-scan');
  assert.equal(serp.hostnameOf, hostnameOf);
  assert.equal(serp.registrableDomain, registrableDomain);
  assert.equal(hostnameOf('https://www.example.com/x'), 'example.com');
  assert.equal(registrableDomain('opt.out.example.com'), 'example.com');
});

test('nothing outside serp-watch imports serp-scan just for the domain helpers', () => {
  const files = ['generic-runner.js', 'lib/broker-runner.js', 'lib/catalog.js', 'lib/catalog-drift.js', 'lib/catalog-survey-core.js', 'lib/catalog-sources.js', 'lib/feeds.js', 'lib/imap-confirm.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/require\(['"][./]*(lib\/)?serp-scan['"]\)/.test(src), `${f} still imports serp-scan`);
  }
});

test('generic-runner takes RECHECK_DAYS from lib/config', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'generic-runner.js'), 'utf8');
  assert.ok(!/const RECHECK_DAYS\s*=/.test(src));
});

test('registrableDomain keeps three labels under a two-label public suffix', () => {
  assert.equal(registrableDomain('www.broker.co.uk'), 'broker.co.uk');
  assert.equal(registrableDomain('broker.co.uk'), 'broker.co.uk');
  assert.equal(registrableDomain('a.b.example.com.au'), 'example.com.au');
  assert.equal(registrableDomain('co.uk'), 'co.uk');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('localhost'), 'localhost');
});

test('catalog-sources uses the same suffix list as lib/domain', () => {
  assert.equal(require('../lib/catalog-sources').BARE_SUFFIXES, require('../lib/domain').BARE_SUFFIXES);
});
