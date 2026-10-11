// test/inspect-broker-forms.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'inspect-broker-forms.js'), 'utf8');
test('the survey script uses a dummy person, never the config', () => {
  assert.match(src, /forPerson\(\{ firstName: 'Jane', lastName: 'Doe'/);
  assert.doesNotMatch(src, /loadConfig|config\.json/);
});
test('the survey script never clicks or submits', () => {
  assert.doesNotMatch(src, /\.click\(|\.submit\(|requestSubmit|press\('Enter'\)/);
});
test('the survey script checks Mullvad before visiting anything', () => {
  assert.match(src, /ensureNodeEgress/);
});
test('ASSIST=1 lets the member clear a bot check before the page is recorded', () => {
  assert.match(src, /process\.env\.ASSIST === '1'/);
  assert.match(src, /waitForHumanCheck\(page/);
});
test('the survey records opt-out links, so a "click here first" step can be found', () => {
  assert.match(src, /const links = \[\.\.\.document\.querySelectorAll\(.a.\)\]/);
});
