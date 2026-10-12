'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findEmailTarget } = require('../lib/email-step');

const names = ['Claritas', 'Data Axle', 'DataMasters', 'Wiland'];

test('an exact name wins, case-insensitive', () => {
  assert.deepEqual(findEmailTarget(names, 'claritas'), { name: 'Claritas' });
});

test('a unique substring matches', () => {
  assert.deepEqual(findEmailTarget(names, 'wil'), { name: 'Wiland' });
});

test('an ambiguous query refuses and lists the matches', () => {
  const r = findEmailTarget(names, 'data');
  assert.match(r.error, /Data Axle/);
  assert.match(r.error, /DataMasters/);
});

test('no match refuses', () => {
  assert.match(findEmailTarget(names, 'nobody').error, /No email broker/);
});
