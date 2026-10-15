'use strict';
/**
 * test/assist-advice.test.js - a run without --assist that met a solvable bot
 * check says how to finish those sites; the docs recommend --assist and say
 * what verify really covers.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('assistHint names the sites and the command, singular and plural', () => {
  const { assistHint } = require('../lib/logger');
  assert.equal(assistHint({ assistable: [] }), null);
  assert.equal(assistHint({}), null);
  assert.equal(assistHint({ assistable: ['Spokeo'] }),
    '1 site was blocked by a bot check: run `upec-wipe run --assist --only "Spokeo"` while at the computer to finish it.');
  assert.equal(assistHint({ assistable: ['Spokeo', 'MyLife', 'Spokeo'] }),
    '2 sites were blocked by bot checks: run `upec-wipe run --assist --only "Spokeo,MyLife"` while at the computer to finish them.');
});

test('resetResults clears the assistable list', () => {
  const logger = require('../lib/logger');
  logger.results.assistable.push('X');
  logger.resetResults();
  assert.deepEqual(logger.results.assistable, []);
});

test('the runner notes only solvable blocks met without --assist', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'broker-runner.js'), 'utf8');
  assert.match(src, /if \(!opts\.assist && blocked\.solvable\) results\.assistable\.push\(broker\.name\);/);
});

test('a run without --assist prints the hint after the summary', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'modes', 'run.js'), 'utf8');
  assert.match(src, /if \(!ASSIST\) \{\s*const hint = assistHint\(results\);/);
});

test('the docs recommend --assist and say what verify covers', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /upec-wipe run --assist/);
  assert.match(readme, /verify --assist` re-checks the 5 brokers whose search it can read/);
  const manual = fs.readFileSync(path.join(ROOT, 'docs', 'UPEC-MANUAL.md'), 'utf8');
  assert.match(manual, /node bin\/upec-wipe\.js run --assist/);
  assert.match(manual, /Spokeo, WhitePages, FastPeopleSearch, MyLife and USPhonebook/);
});
