'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { watcherSource, modeSource } = require('./helpers/watcher-source');

const src = watcherSource();

test('--know goes through runKnowStep with the shared email-step wiring', () => {
  assert.match(src, /runKnowStep\(/);
  assert.ok(!/sendKnowRequests/.test(src), 'the old separate sender must be gone');
  assert.equal((modeSource('run').match(/\.\.\.emailStepIo\(\)/g) || []).length, 1, '--email uses the shared wiring');
  assert.match(modeSource('know'), /io: emailStepIo/, '--know uses the same wiring');
});

test('the shared email transport is built with smtpTransportOptions (TLS rules)', () => {
  assert.match(modeSource('shared'), /nodemailer\.createTransport\(smtpTransportOptions\(smtp\)\)/);
});

test('--know saves state after the know step so a newly minted alias is kept', () => {
  const know = modeSource('know');
  const a = know.indexOf('await d.runKnowStep(');
  const b = know.indexOf('getPendingKnowRequests(', a);
  assert.ok(a > 0 && b > a);
  assert.ok(know.slice(a, b).includes('saveState()'));
});

test('--know .catch saves state before releasing the lock and prints an EgressError plainly', () => {
  const know = modeSource('know');
  assert.match(know, /catch \(err\) \{[\s\S]*saveState\(\)/);
  const block = know.slice(know.indexOf('catch (err) {'));
  const save = block.indexOf('saveState()');
  const release = block.indexOf('lock.release(KNOW_LOCK_PATH)');
  assert.ok(save > 0, 'the catch block must call saveState()');
  assert.ok(release > save, 'saveState() must run before the lock is released');
  assert.match(block, /err instanceof EgressError/);
});

test.skip('--know checks the email setup before it can create a SimpleLogin alias (replaced by Task 7)', () => {
  const block = src.slice(src.indexOf('if (KNOW_MODE) {'), src.indexOf('const code = await runKnowStep('));
  const check = block.indexOf('checkEmailSetup(');
  assert.ok(check > 0, 'checkEmailSetup is called in the --know block');
  assert.ok(check < block.indexOf('buildSubmissionPlan('), 'and before buildSubmissionPlan');
});
