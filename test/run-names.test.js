'use strict';
/**
 * test/run-names.test.js
 *
 * Review 2026-10-15: a misspelt --skip name was ignored (the broker the member
 * meant to skip was submitted), --only with --skip or --retry-failed silently
 * dropped one of them, and the name check ran after the email step, so
 * `--email --forms --only "A,Typo"` sent email and then said "Nothing was run".
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkRunNames } = require('../lib/filter');

const known = ['Spokeo', 'Pipl', 'WhitePages'];

test('known names pass', () => {
  assert.equal(checkRunNames({ only: 'Spokeo,Pipl', known }), null);
  assert.equal(checkRunNames({ skip: 'WhitePages', known }), null);
  assert.equal(checkRunNames({ known }), null);
});

test('a misspelt --skip name refuses with a suggestion', () => {
  const lines = checkRunNames({ skip: 'Spokoe', known });
  assert.match(lines.join('\n'), /--skip: no broker or catalog site is named "Spokoe" \(did you mean "Spokeo"\?\)/);
  assert.match(lines.join('\n'), /Nothing was run/);
});

test('a misspelt --only name still refuses', () => {
  assert.match(checkRunNames({ only: 'Spokeo,Pipll', known }).join('\n'), /--only: no broker or catalog site is named "Pipll"/);
});

test('--only cannot be combined with --skip or --retry-failed', () => {
  assert.match(checkRunNames({ only: 'Spokeo', skip: 'Pipl', known }).join('\n'), /cannot be combined/);
  assert.match(checkRunNames({ only: 'Spokeo', retryFailed: true, known }).join('\n'), /cannot be combined/);
  assert.match(checkRunNames({ skip: 'Pipl', retryFailed: true, known }).join('\n'), /cannot be combined/);
});

test('run.js checks the names before the email step sends anything', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'modes', 'run.js'), 'utf8');
  const check = src.indexOf('checkRunNames(');
  const send = src.indexOf('runEmailStep(');
  assert.ok(check !== -1 && send !== -1, 'both calls are present');
  assert.ok(check < send, 'checkRunNames comes first');
});
