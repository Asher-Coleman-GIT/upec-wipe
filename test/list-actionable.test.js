/**
 * test/list-actionable.test.js
 *
 * `upec-wipe list` shows only catalog sites the member can act on: reviewed
 * (the run fills them) and manual (done by hand). Email sites have their own
 * section; excluded, unreviewed and needs-review sites are counted, not listed.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { actionableCatalog } = require('../lib/catalog');

const row = (name, state) => ({ name, domain: `${name}.example`, state, reviewedAt: null, optOutUrl: null });

test('only reviewed and manual sites are shown', () => {
  const { shown } = actionableCatalog([
    row('a', 'reviewed'), row('b', 'manual'), row('c', 'excluded'),
    row('d', 'unreviewed'), row('e', 'needs-review'), row('f', 'email'),
  ]);
  assert.deepEqual(shown.map(s => s.name), ['a', 'b']);
});

test('the hidden line counts what is left out, email sites pointing to their section', () => {
  const { hiddenLine } = actionableCatalog([
    row('a', 'reviewed'), row('c', 'excluded'), row('c2', 'excluded'),
    row('d', 'unreviewed'), row('e', 'needs-review'), row('f', 'email'),
  ]);
  assert.equal(hiddenLine,
    'Not shown: 2 excluded (not about individuals), 2 not yet reviewed, 1 email (see Email requests).');
});

test('nothing hidden means no hidden line', () => {
  assert.equal(actionableCatalog([row('a', 'reviewed')]).hiddenLine, null);
});

// Spawned in a config-free copy of the repo with its own empty state file.
const { makeFixtureRepo, runIn } = require('./helpers/fixture-repo');
const FIXTURE = makeFixtureRepo();
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));

test('upec-wipe list prints no excluded or unreviewed rows, and the hidden line', () => {
  const statePath = path.join(FIXTURE, 'state.test.json');
  const r = runIn(FIXTURE, 'bin/upec-wipe.js', ['list'], { statePath });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, out);
  const catalog = out.split(/\nCatalog sites/)[1].split(/\nEmail requests/)[0];
  assert.doesNotMatch(catalog, /^.{40}(excluded|unreviewed|needs-review|email)\b/m);
  assert.match(catalog, /^.{40}manual\b/m);
  assert.match(catalog, /^Not shown: \d+ excluded \(not about individuals\)/m);
});
