'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { knowFlow } = require('../lib/modes/know');
const { makeEgressCounter } = require('../lib/modes/run');
const { modeSource } = require('./helpers/watcher-source');

const P = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Austin', state: 'TX', email: 'jane.doe@example.com' };

test('know: a refused setup never reaches SimpleLogin', async () => {
  let planned = 0;
  const lines = [];
  const code = await knowFlow({ config: {}, persons: [P], state: {}, brokers: [], preview: false }, {
    checkEmailSetup: () => 'add an email.smtp block',
    buildSubmissionPlan: async () => { planned++; return { allowed: [], blocked: [] }; },
    log: (l) => lines.push(l), isTTY: () => true,
  });
  assert.equal(code, 1);
  assert.equal(planned, 0);
  assert.match(lines.join('\n'), /Right-to-know not sent: add an email\.smtp block/);
});

test('know: a good setup checks, plans, sends, then saves, in that order', async () => {
  const order = [];
  const code = await knowFlow({ config: {}, persons: [P], state: {}, brokers: [], preview: false }, {
    checkEmailSetup: () => { order.push('check'); return null; },
    buildSubmissionPlan: async () => { order.push('plan'); return { allowed: [], blocked: [] }; },
    runKnowStep: async () => { order.push('send'); return 0; },
    saveState: () => { order.push('save'); },
    getPendingKnowRequests: () => [],
    io: () => ({}), log: () => {}, isTTY: () => true,
  });
  assert.equal(code, 0);
  assert.deepEqual(order, ['check', 'plan', 'send', 'save']);
});

test('run: the egress counter re-checks every 10th broker across persons', async () => {
  let checks = 0;
  const before = makeEgressCounter(async () => { checks++; }, 10);
  for (let i = 0; i < 7; i++) await before();   // person 1
  for (let i = 0; i < 14; i++) await before();  // person 2
  assert.equal(checks, 2);                      // brokers 10 and 20 overall
});

test('run: one counter is made before the persons loop', () => {
  const src = modeSource('run');
  const made = src.indexOf('const beforeBroker = makeEgressCounter(');
  assert.ok(made > 0);
  assert.ok(made < src.indexOf('for (const { person, email: submissionEmail, masked } of plan.allowed)'));
});
