'use strict';
/**
 * test/redact-personal-query.test.js
 *
 * 2026-10-15: the CheckPeople manual card showed
 * checkpeople.com/opt-out?firstName=<real>&lastName=<real>, and the member
 * pasted the manual list into a chat. Links on manual cards now lose a query
 * string that carries the person's details; paths (your own listing) stay.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dropPersonalQueries } = require('../lib/redact');

const JANE = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'North Exampleton', zip: '84000', email: 'jane@example.com' };

test('a query with the person\'s name is dropped, the rest of the text kept', () => {
  assert.equal(
    dropPersonalQueries('Blocked by bot protection - open in your normal browser: https://checkpeople.com/opt-out?firstName=Jane&lastName=Doe&state=UT', [JANE]),
    'Blocked by bot protection - open in your normal browser: https://checkpeople.com/opt-out');
});

test('encoded values and any listed person count; harmless queries stay', () => {
  assert.equal(dropPersonalQueries('see https://b.example/s?q=Jane%20Doe&x=1', [{ firstName: 'Ann' }, JANE]), 'see https://b.example/s');
  assert.equal(dropPersonalQueries('see https://b.example/s?city=North+Exampleton', [JANE]), 'see https://b.example/s');
  assert.equal(dropPersonalQueries('form at https://b.example/optout?ref=menu', [JANE]), 'form at https://b.example/optout?ref=menu');
});

test('paths are kept: a listing link is what the member needs', () => {
  assert.equal(dropPersonalQueries('you are listed at https://www.spokeo.com/Jane-Doe/Utah/North-Exampleton/p1', [JANE]),
    'you are listed at https://www.spokeo.com/Jane-Doe/Utah/North-Exampleton/p1');
});

test('the run and the manual list both use it', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const runner = fs.readFileSync(path.join(__dirname, '..', 'lib', 'broker-runner.js'), 'utf8');
  assert.match(runner, /dropPersonalQueries\(raw, \[person\]\)/);
  const mode = fs.readFileSync(path.join(__dirname, '..', 'lib', 'modes', 'manual.js'), 'utf8');
  assert.match(mode, /dropPersonalQueries\(/);
});
