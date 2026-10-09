/**
 * test/helpers/test-state.js
 *
 * Loaded by the test preload (egress-off.js). Points AIDR_STATE_PATH at a
 * per-process temp file unless something already set it, so parallel test
 * files never race on, or write to, the repo's own state.json. Children
 * inherit the parent's path; tests that need their own state file set
 * AIDR_STATE_PATH explicitly or call setTestStatePath.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.AIDR_STATE_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-test-state-'));
  process.env.AIDR_STATE_PATH = path.join(dir, 'state.json');
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
}
