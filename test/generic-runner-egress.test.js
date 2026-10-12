'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runGenericBrokers } = require('../generic-runner');
const { EgressError } = require('../lib/egress');

test('the generic pass re-checks egress every 10 brokers and stops when it fails', async () => {
  const brokers = Array.from({ length: 25 }, (_, i) => ({ name: `B${i}`, url: `https://b${i}.example/` }));
  let checks = 0;
  const seen = [];
  const context = { newPage: async () => ({ close: async () => {}, waitForTimeout: async () => {} }) };
  await assert.rejects(
    () => runGenericBrokers(context, new Set(), { optOuts: {} }, () => {}, () => {}, {
      injectedBrokers: brokers,
      injectedProcessFn: async (_page, b) => { seen.push(b.name); return { status: 'manual', detail: '' }; },
      recheckEgress: async () => { checks++; if (checks === 2) throw new EgressError('dropped'); },
    }),
    EgressError
  );
  assert.equal(checks, 2);
  assert.equal(seen.length, 20);
});

test('an EgressError from one broker stops the pass instead of being logged as an error', async () => {
  const context = { newPage: async () => ({ close: async () => {}, waitForTimeout: async () => {} }) };
  await assert.rejects(
    () => runGenericBrokers(context, new Set(), { optOuts: {} }, () => {}, () => {}, {
      injectedBrokers: [{ name: 'A', url: 'https://a.example/' }],
      injectedProcessFn: async () => { throw new EgressError('dropped'); },
    }),
    EgressError
  );
});
