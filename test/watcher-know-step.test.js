'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');

test('--know goes through runKnowStep with the shared email-step wiring', () => {
  assert.match(src, /runKnowStep\(/);
  assert.ok(!/sendKnowRequests/.test(src), 'the old separate sender must be gone');
  assert.equal((src.match(/\.\.\.emailStepIo\(\)/g) || []).length, 2, '--email and --know share one wiring');
});

test('the shared email transport is built with smtpTransportOptions (TLS rules)', () => {
  assert.match(src, /nodemailer\.createTransport\(smtpTransportOptions\(smtp\)\)/);
});

test('--know saves state after the know step so a newly minted alias is kept', () => {
  const a = src.indexOf('const code = await runKnowStep(');
  const b = src.indexOf('getPendingKnowRequests(brokers', a);
  assert.ok(a > 0 && b > a);
  assert.ok(src.slice(a, b).includes('saveState()'));
});

test('--know .catch saves state before releasing the lock and prints an EgressError plainly', () => {
  const a = src.indexOf('if (KNOW_MODE) {');
  const c = src.indexOf('}).catch(err => {', a);
  const end = src.indexOf('} else {', c);
  assert.ok(a > 0 && c > a && end > c);
  const block = src.slice(c, end);
  const save = block.indexOf('saveState()');
  const release = block.indexOf('lock.release(KNOW_LOCK_PATH)');
  assert.ok(save > 0, 'the .catch block must call saveState()');
  assert.ok(release > save, 'saveState() must run before the lock is released');
  assert.match(block, /err instanceof EgressError/);
});

test('--know checks the email setup before it can create a SimpleLogin alias', () => {
  const block = src.slice(src.indexOf('if (KNOW_MODE) {'), src.indexOf('const code = await runKnowStep('));
  const check = block.indexOf('checkEmailSetup(');
  assert.ok(check > 0, 'checkEmailSetup is called in the --know block');
  assert.ok(check < block.indexOf('buildSubmissionPlan('), 'and before buildSubmissionPlan');
});
