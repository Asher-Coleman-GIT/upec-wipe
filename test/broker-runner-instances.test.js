'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrokerRunner } = require('../lib/broker-runner');
const { results } = require('../lib/logger');
const config = require('../lib/config');

test('two runners keep their own options', async () => {
  config.setDryRun(true); // no checkpoint or state written
  try {
    const broker = { name: 'Acme', method: 'manual', notes: 'by hand' };
    const keep = createBrokerRunner({ config: { allowlist: ['Acme'] }, person: { firstName: 'Jane', lastName: 'Doe' } });
    const run = createBrokerRunner({ config: { allowlist: [] }, person: { firstName: 'Jane', lastName: 'Doe' } });
    const skippedBefore = results.skipped.length;
    const manualBefore = results.manual.length;
    await keep.processBroker({}, broker);
    await run.processBroker({}, broker);
    assert.equal(results.skipped.length - skippedBefore, 1, 'the allowlisting runner skipped it');
    assert.equal(results.manual.length - manualBefore, 1, 'the other runner did not inherit the allowlist');
  } finally {
    config.setDryRun(false);
  }
});

test('a created runner ignores the default runner configure() state', async () => {
  const br = require('../lib/broker-runner');
  config.setDryRun(true);
  try {
    br.configure({ config: { allowlist: ['Acme'] } });
    const fresh = createBrokerRunner({ config: { allowlist: [] }, person: { firstName: 'Jane', lastName: 'Doe' } });
    const manualBefore = results.manual.length;
    await fresh.processBroker({}, { name: 'Acme', method: 'manual', notes: 'by hand' });
    assert.equal(results.manual.length - manualBefore, 1, 'the default allowlist did not leak in');
  } finally {
    br.configure({ config: null });
    config.setDryRun(false);
  }
});
