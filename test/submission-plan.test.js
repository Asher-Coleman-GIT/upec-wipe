/**
 * test/submission-plan.test.js
 *
 * Fork policy: every web submission for a person uses the relay alias resolved
 * once up front. A person whose alias cannot be obtained is blocked; everyone
 * else still runs.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSubmissionPlan } = require('../lib/submission-plan');

const A = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: 'jane@example.com' };
const B = { firstName: 'John', lastName: 'Roe', fullName: 'John Roe', email: 'john@example.com' };
const RELAY = { relay: { provider: 'simplelogin', apiKey: 'k' } };

test('relay.required false: everyone allowed with real email, masked=false', async () => {
  const plan = await buildSubmissionPlan({ config: { relay: { required: false } }, persons: [A, B], state: {} });
  assert.deepEqual(plan.allowed.map(x => [x.email, x.masked]), [['jane@example.com', false], ['john@example.com', false]]);
  assert.equal(plan.blocked.length, 0);
});

test('no relay block: everyone blocked, nobody gets the real email', async () => {
  const plan = await buildSubmissionPlan({ config: {}, persons: [A, B], state: {} });
  assert.equal(plan.allowed.length, 0);
  assert.equal(plan.blocked.length, 2);
});

test('one alias failure blocks only that person', async () => {
  let n = 0;
  const createImpl = async () => {
    if (++n === 1) throw new Error('HTTP 500');
    return 'john-alias@simplelogin.com';
  };
  const plan = await buildSubmissionPlan({ config: RELAY, persons: [A, B], state: {}, createImpl });
  assert.equal(plan.allowed.length, 1);
  assert.equal(plan.allowed[0].person, B);
  assert.equal(plan.allowed[0].email, 'john-alias@simplelogin.com');
  assert.equal(plan.allowed[0].masked, true);
  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.blocked[0].person, A);
  assert.match(plan.blocked[0].reason, /500/);
});

test('unexpected errors are not swallowed', async () => {
  // Only RelayUnavailableError means "block this person"; a programming error
  // (here: persons is not iterable) must surface.
  await assert.rejects(() => buildSubmissionPlan({ config: RELAY, persons: null, state: {} }), TypeError);
});

test('preview plan: no alias minted, placeholder flagged, required relay still blocks', async () => {
  let calls = 0;
  const createImpl = async () => { calls += 1; return 'minted@simplelogin.com'; };
  const state = { relayAliases: { 'john@example.com': 'john-cached@simplelogin.com' } };
  const plan = await buildSubmissionPlan({ config: RELAY, persons: [A, B], state, createImpl, preview: true });
  assert.equal(calls, 0, 'SimpleLogin API must not be called in preview');
  assert.deepEqual(plan.allowed.map(x => [x.email, x.placeholder]), [
    ['preview-alias@relay.invalid', true],
    ['john-cached@simplelogin.com', false],
  ]);
  const req = await buildSubmissionPlan({ config: { relay: { required: true } }, persons: [A], state: {}, preview: true });
  assert.equal(req.allowed.length, 0);
  assert.equal(req.blocked.length, 1);
});
