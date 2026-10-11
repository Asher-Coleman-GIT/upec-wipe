/**
 * test/us-state.test.js
 *
 * State-limited brokers (California DROP) compare the member's state to a
 * 2-letter code. A config that says "California" or " ca" must still match.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUsState } = require('../lib/us-state');

test('2-letter codes are upper-cased and trimmed', () => {
  assert.equal(normalizeUsState('ca'), 'CA');
  assert.equal(normalizeUsState(' CA '), 'CA');
});
test('full names map to codes, any case, extra spaces ignored', () => {
  assert.equal(normalizeUsState('California'), 'CA');
  assert.equal(normalizeUsState('  new   york '), 'NY');
  assert.equal(normalizeUsState('District of Columbia'), 'DC');
});
test('unknown or missing values become empty', () => {
  assert.equal(normalizeUsState('Ontario'), '');
  assert.equal(normalizeUsState(''), '');
  assert.equal(normalizeUsState(undefined), '');
});
