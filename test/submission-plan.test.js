/**
 * test/submission-plan.test.js
 *
 * Fork policy: the generic pass is opt-in, and every web submission for a person
 * uses the relay alias resolved once up front. A person whose alias cannot be
 * obtained is blocked; everyone else still runs.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isGenericEnabled, buildSubmissionPlan, withSubmissionEmail } = require('../lib/submission-plan');

const A = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: 'jane@example.com' };
const B = { firstName: 'John', lastName: 'Roe', fullName: 'John Roe', email: 'john@example.com' };
const RELAY = { relay: { provider: 'simplelogin', apiKey: 'k' } };

test('generic pass is off by default', () => {
  assert.equal(isGenericEnabled(['node', 'watcher.js'], {}), false);
  assert.equal(isGenericEnabled(['node', 'watcher.js'], { generic: { enabled: 'true' } }), false);
});

test('generic pass turns on with --generic or generic.enabled === true', () => {
  assert.equal(isGenericEnabled(['node', 'watcher.js', '--generic'], {}), true);
  assert.equal(isGenericEnabled(['node', 'watcher.js'], { generic: { enabled: true } }), true);
});

test('no relay: everyone allowed with real email, masked=false', async () => {
  const plan = await buildSubmissionPlan({ config: {}, persons: [A, B], state: {} });
  assert.deepEqual(plan.allowed.map(x => [x.email, x.masked]), [['jane@example.com', false], ['john@example.com', false]]);
  assert.equal(plan.blocked.length, 0);
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

test('withSubmissionEmail swaps only the email', () => {
  const p = withSubmissionEmail(A, 'alias@simplelogin.com');
  assert.notEqual(p, A);
  assert.equal(p.email, 'alias@simplelogin.com');
  assert.equal(p.firstName, 'Jane');
  assert.equal(A.email, 'jane@example.com', 'original not mutated');
  assert.equal(withSubmissionEmail(A, A.email), A);
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
