/**
 * test/dry-run-footer.test.js
 *
 * A dry run or preview writes no run log and saves no state, so its closing
 * lines must not point at a log file or state file as if it had.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');

test('a dry run says no log was written instead of naming the log file', () => {
  assert.match(src, /if \(DRY_RUN\) \{\s*console\.log\(`\\nLog: none/);
});

test('the log and state paths are printed only in the real-run branch', () => {
  const m = src.match(/\} else \{\s*console\.log\(`\\nLog: \$\{logFile\}`\);\s*console\.log\(`State: \$\{STATE_PATH\}\\n`\);\s*\}/);
  assert.ok(m, 'Log/State footer sits in the else branch of if (DRY_RUN)');
  assert.equal(src.split('Log: ${logFile}').length - 1, 1, 'no other unguarded Log line');
});
