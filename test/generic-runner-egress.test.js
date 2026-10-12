'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runGenericBrokers } = require('../generic-runner');
const { EgressError } = require('../lib/egress');

test('the generic pass re-checks egress before its first broker and every 10 after, and stops when it fails', async () => {
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
  assert.equal(seen.length, 10);
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

test('the first re-check runs before any broker is visited', async () => {
  const brokers = Array.from({ length: 25 }, (_, i) => ({ name: `B${i}`, url: `https://b${i}.example/` }));
  const events = [];
  const context = { newPage: async () => ({ close: async () => {}, waitForTimeout: async () => {} }) };
  await runGenericBrokers(context, new Set(), { optOuts: {} }, () => {}, () => {}, {
    injectedBrokers: brokers,
    injectedProcessFn: async (_page, b) => { events.push(b.name); return { status: 'manual', detail: '' }; },
    recheckEgress: async () => { events.push('check'); },
  });
  assert.equal(events[0], 'check');
  assert.equal(events[11], 'check');
  assert.equal(events.filter(e => e === 'check').length, 3);
});
