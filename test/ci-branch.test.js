'use strict';
// 2026-10-16: the default branch was renamed to upec-wipe-main, and CI still
// ran only on pushes to `main`, a branch that no longer exists.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('CI runs on pushes to the default branch', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'test.yml'), 'utf8');
  assert.match(wf, /push:\s*\n\s*branches: \[upec-wipe-main\]/);
});
