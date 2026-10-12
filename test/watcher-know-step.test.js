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
