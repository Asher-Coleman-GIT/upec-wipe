'use strict';
/**
 * test/preview-dummy.test.js
 *
 * 2026-10-15 review: `preview` typed the member's real name, city, ZIP and date
 * of birth into every broker form without submitting, on pages that run tag
 * managers and ad scripts, and searched every broker for the real name. Now a
 * preview (and --dry-run) fills the forms with a dummy person and skips the
 * listing searches; only the state and country are kept, so the same brokers
 * apply. `preview --email` still shows the real letters on screen only.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { previewPerson, PREVIEW_PERSON_NOTE } = require('../lib/preview');
const { PREVIEW_ALIAS } = require('../lib/relay');

const REAL = { firstName: 'Realfirst', lastName: 'Reallast', fullName: 'Realfirst Reallast', city: 'Realcity', state: 'UT', country: 'US', zip: '84999', email: 'real@example.com', dob: '1970-05-05' };

test('the preview person keeps only state and country', () => {
  const p = previewPerson(REAL);
  assert.equal(p.state, 'UT');
  assert.equal(p.country, 'US');
  assert.equal(p.email, PREVIEW_ALIAS);
  const flat = JSON.stringify(p).toLowerCase();
  for (const v of ['realfirst', 'reallast', 'realcity', '84999', 'real@example.com', '1970']) assert.doesNotMatch(flat, new RegExp(v), v);
  assert.equal(p.fullName, 'Jane Doe');
  assert.ok(require('../lib/dob').parseDob(p.dob), 'a dob the dob-only forms can use');
});

test('the preview person works without a real person too', () => {
  const p = previewPerson(undefined);
  assert.equal(p.country, 'US');
  assert.ok(p.state);
});

test('a preview or dry run plans the dummy person only, with the placeholder alias', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'modes', 'run.js'), 'utf8');
  assert.match(src, /if \(DRY_RUN\) \{\s*\n\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*plan = \{ allowed: \[\{ person: previewPerson\(persons\[0\]\), email: PREVIEW_ALIAS/);
  assert.match(src, /console\.log\(PREVIEW_PERSON_NOTE\)/);
  assert.match(src, /rehearsal: DRY_RUN/);
  assert.match(PREVIEW_PERSON_NOTE, /dummy person/);
});
