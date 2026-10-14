'use strict';
/**
 * test/captcha-error-detail.test.js
 *
 * FamilyTreeNow, 2026-10-14: "CapSolver hCAPTCHA error: Request failed with
 * status code 400" - the reason CapSolver gives (errorCode, errorDescription
 * in the response body) was dropped, so nobody could tell an unsupported task
 * from a bad key or an empty balance. The log line now carries them, never the
 * API key.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('a CapSolver error shows its errorCode and description, not the key', async () => {
  const { solveHcaptcha } = require('../lib/captcha');
  const axios = require('axios');
  const origCreate = axios.create;
  axios.create = () => ({
    post: async () => {
      const err = new Error('Request failed with status code 400');
      err.response = { status: 400, data: { errorId: 1, errorCode: 'ERROR_INVALID_TASK_DATA', errorDescription: 'Unsupported task type' } };
      throw err;
    },
  });
  const lines = [];
  const origLog = console.log;
  console.log = (m) => lines.push(String(m));
  let ok;
  try {
    const page = { url: () => 'https://broker.example.com/optout', evaluate: async (fn) => (typeof fn === 'function' ? 'site-key-1' : undefined) };
    ok = await solveHcaptcha(page, { apiKey: 'CAP-SECRETKEY123' });
  } finally {
    console.log = origLog;
    axios.create = origCreate;
  }
  assert.equal(ok, false);
  const line = lines.find(l => /hCAPTCHA error/.test(l));
  assert.ok(line, lines.join('\n'));
  assert.match(line, /ERROR_INVALID_TASK_DATA/);
  assert.match(line, /Unsupported task type/);
  assert.doesNotMatch(lines.join('\n'), /CAP-SECRETKEY123/);
});
