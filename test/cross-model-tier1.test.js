'use strict';
/**
 * test/cross-model-tier1.test.js
 *
 * Review 2026-10-15 (low): the review and gate scripts kept separate tier-1
 * lists that had drifted (neither had lib/egress.js or lib/catalog.js, one
 * still named the removed lib/scheduler.js); cross-model-review.sh died with
 * exit 1 (read as "a P1") when the last changed file was not code; the gate
 * read a failed git diff as "no tier-1 files changed".
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LIST = 'scripts/cross-model-tier1.txt';

test('one tier-1 list, of files that exist, read by both scripts and matching the policy table', () => {
  const files = read(LIST).split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  for (const f of ['lib/egress.js', 'lib/catalog.js', 'lib/secrets.js']) assert.ok(files.includes(f), f);
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  const policy = read('docs/CROSS_MODEL_REVIEW.md');
  for (const f of files) assert.ok(policy.includes('`' + f + '`'), `the policy table lists ${f}`);
  assert.doesNotMatch(policy, /lib\/scheduler\.js/);
  for (const s of ['scripts/cross-model-review.sh', 'scripts/cross-model-gate.sh']) {
    assert.match(read(s), /cross-model-tier1\.txt/, `${s} reads the list`);
    assert.doesNotMatch(read(s), /lib\/config\.js lib\/secrets\.js|lib\/\(config\|secrets/, `${s} keeps no list of its own`);
  }
});

test('a non-code last file does not end the target selection with a failure', () => {
  assert.doesNotMatch(read('scripts/cross-model-review.sh'), /is_reviewable "\$f" && echo "\$f"/);
});

test('the gate fails when git diff fails instead of reporting no tier-1 changes', () => {
  const r = spawnSync('bash', [path.join(ROOT, 'scripts/cross-model-gate.sh'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /No tier-1 files changed/);
});
