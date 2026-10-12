// test/catalog-survey-script.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'catalog-survey.js'), 'utf8');
const { resolveCommand } = require('../lib/cli-map');

test('the catalog survey is read-only', () => {
  assert.doesNotMatch(src, /\.click\(|\.check\(|\.fill\(|\.type\(|\.submit\(|requestSubmit|press\(/);
});
test('it never reads the member config', () => {
  assert.doesNotMatch(src, /loadConfig|config\.json/);
});
test('it checks Mullvad before visiting anything', () => {
  assert.ok(src.indexOf('ensureNodeEgress') < src.indexOf('chromium.launch'));
});
test('it writes records atomically, merges and checks drift', () => {
  for (const s of ['writeRecordAtomic(', 'mergeSurvey(', 'detectDrift(', 'applyDrift(']) assert.ok(src.includes(s), s);
});
test('ASSIST=1 waits for the member at solvable checks', () => {
  assert.match(src, /process\.env\.ASSIST === '1'/);
  assert.match(src, /waitForHumanCheck\(page/);
});
test('--resume skips sites surveyed in the last 7 days', () => {
  assert.match(src, /RESUME_DAYS = 7/);
});
test('upec-wipe catalog-check runs the survey over reviewed sites', () => {
  const r = resolveCommand(['catalog-check']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, ['scripts/catalog-survey.js', '--reviewed']);
});
