/**
 * test/helpers/test-state.js
 *
 * Loaded by the test preload (egress-off.js). Gives every test file its own
 * temp UPEC_WIPE_STATE_PATH, so parallel test files never race on, or write to,
 * the repo's state.json.
 *
 * The preload runs first in the `node --test` orchestrator, whose env every
 * test-file process inherits. So the orchestrator records its pid
 * (UPEC_WIPE_TEST_STATE_ROOT_PID) and the path it made (UPEC_WIPE_TEST_STATE_AUTO). A
 * direct child of the orchestrator (a test file) that still sees that auto path
 * makes its own. Processes a test spawns inherit the test file's path, and a
 * path a test set explicitly is never replaced.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const env = process.env;
const inheritedAuto = !!env.UPEC_WIPE_TEST_STATE_AUTO && env.UPEC_WIPE_STATE_PATH === env.UPEC_WIPE_TEST_STATE_AUTO;
const isTestFile = String(process.ppid) === env.UPEC_WIPE_TEST_STATE_ROOT_PID;

if (!env.UPEC_WIPE_STATE_PATH || (inheritedAuto && isTestFile)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-test-state-'));
  env.UPEC_WIPE_STATE_PATH = path.join(dir, 'state.json');
  env.UPEC_WIPE_TEST_STATE_AUTO = env.UPEC_WIPE_STATE_PATH;
  if (!env.UPEC_WIPE_TEST_STATE_ROOT_PID) env.UPEC_WIPE_TEST_STATE_ROOT_PID = String(process.pid);
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
}
