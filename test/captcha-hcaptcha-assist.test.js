'use strict';
/**
 * test/captcha-hcaptcha-assist.test.js
 *
 * FamilyTreeNow, 2026-10-15: CapSolver answered "ERROR_INVALID_TASK_DATA: We
 * don't support this service" for hCAPTCHA. Every attempt was a paid call that
 * could only fail. hCAPTCHA now never goes to CapSolver: with --assist the run
 * waits for the member to solve it in the browser window; without it the broker
 * is handed over (and counted for the "--assist --only" advice).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { detectAndSolveCaptcha } = require('../lib/captcha');

// First evaluate is the captcha type probe; later ones read whether the
// h-captcha-response field holds a token yet.
function hcaptchaPage(answered) {
  let n = 0;
  return {
    url: () => 'https://broker.example/optout',
    bringToFront: async () => {},
    waitForLoadState: async () => {},
    evaluate: async () => (n++ === 0 ? 'hcaptcha' : answered.shift() ?? false),
  };
}

async function quiet(fn) {
  const lines = [];
  const origLog = console.log;
  const origCreate = axios.create;
  let capsolverCalls = 0;
  axios.create = () => ({ post: async () => { capsolverCalls++; throw new Error('CapSolver must not be called'); } });
  console.log = (m) => lines.push(String(m));
  try {
    const ok = await fn();
    return { ok, lines, capsolverCalls };
  } finally {
    console.log = origLog;
    axios.create = origCreate;
  }
}

const fastWait = { pollMs: 1, sleep: async () => {} };

test('hCAPTCHA without --assist: no CapSolver call, counted as assistable, says how to do it', async () => {
  const assistable = [];
  const r = await quiet(() => detectAndSolveCaptcha(hcaptchaPage([]), { apiKey: 'CAP-REALKEY123' }, { name: 'FamilyTreeNow' },
    { assist: false, onAssistable: () => assistable.push('FamilyTreeNow') }));
  assert.equal(r.ok, false);
  assert.equal(r.capsolverCalls, 0);
  assert.deepEqual(assistable, ['FamilyTreeNow']);
  assert.match(r.lines.join('\n'), /--assist/);
});

test('hCAPTCHA with --assist: waits until the member has solved it, then continues', async () => {
  const assistable = [];
  const r = await quiet(() => detectAndSolveCaptcha(hcaptchaPage([false, false, true]), { apiKey: 'CAP-REALKEY123' }, { name: 'FamilyTreeNow' },
    { assist: true, onAssistable: () => assistable.push('x'), assistWait: fastWait }));
  assert.equal(r.ok, true);
  assert.equal(r.capsolverCalls, 0);
  assert.deepEqual(assistable, []);
  assert.match(r.lines.join('\n'), /FamilyTreeNow.*hCAPTCHA/);
  assert.match(r.lines.join('\n'), /do not press submit/i);
});

test('hCAPTCHA with --assist: not solved in time is a failure for this broker', async () => {
  let t = 0;
  const r = await quiet(() => detectAndSolveCaptcha(hcaptchaPage([]), { apiKey: 'CAP-REALKEY123' }, { name: 'FamilyTreeNow' },
    { assist: true, assistWait: { timeoutMs: 50, pollMs: 10, sleep: async (ms) => { t += ms; }, now: () => t } }));
  assert.equal(r.ok, false);
  assert.equal(r.capsolverCalls, 0);
});

test('the CapSolver hCAPTCHA solver is gone', () => {
  const captcha = require('../lib/captcha');
  assert.equal(captcha.solveHcaptcha, undefined);
  assert.doesNotMatch(require('node:fs').readFileSync(require.resolve('../lib/captcha'), 'utf8'), /HCaptchaTask/);
});
