'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { askLine } = require('../lib/modes/shared');
const { breachFlow } = require('../lib/modes/breach');

const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

test('askLine resolves with the typed line', async () => {
  assert.equal(await askLine('Q? ', { input: Readable.from(['YES\n']), output: sink() }), 'YES');
});

test('askLine resolves empty when input is closed, instead of hanging', async () => {
  assert.equal(await askLine('Q? ', { input: Readable.from([]), output: sink() }), '');
});

test('breach: a refused confirmation never reaches HIBP', async () => {
  let checked = 0;
  const code = await breachFlow({ emails: ['jane.doe@example.com'], apiKey: 'k', brokers: [], config: {} }, {
    confirmBreachCheck: async () => false,
    runBreachCheck: async () => { checked++; return {}; },
    log: () => {},
  });
  assert.equal(code, 1);
  assert.equal(checked, 0);
});

test('breach: a confirmed check runs and returns 0', async () => {
  const order = [];
  const code = await breachFlow({ emails: ['jane.doe@example.com'], apiKey: 'k', brokers: [], config: {} }, {
    confirmBreachCheck: async () => { order.push('confirm'); return true; },
    runBreachCheck: async () => { order.push('check'); return {}; },
    formatBreachReport: () => 'report',
    log: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(order, ['confirm', 'check']);
});
