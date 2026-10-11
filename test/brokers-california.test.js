/**
 * test/brokers-california.test.js
 *
 * California DROP is one manual entry, shown only to California residents.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// brokers.js reads config.json at load time; use the config.example.json values
// by monkeypatching require before importing.
const Module = require('module');
const path = require('path');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './config.json' || request === '../config.json') {
    return require('../config.example.json');
  }
  return origLoad.apply(this, arguments);
};

const brokers = require('../brokers');

Module._load = origLoad;

test('one California DROP entry, manual, CA only, official link', () => {
  const e = brokers.find(b => b.name === 'California DROP');
  assert.ok(e);
  assert.equal(e.method, 'manual');
  assert.deepEqual(e.states, ['CA']);
  assert.equal(e.optOutUrl, 'https://privacy.ca.gov/drop/');
  assert.equal(brokers.find(b => b.name === 'California DELETE Portal'), undefined);
  assert.equal(brokers.find(b => b.name === 'CalPrivacy DROP'), undefined);
});
