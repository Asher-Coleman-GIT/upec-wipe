/**
 * test/test-state-isolation.test.js
 *
 * The npm test preload (test/helpers/egress-off.js) points UPEC_WIPE_STATE_PATH at a
 * per-process temp file, so parallel test files never race on (or write) the
 * repo's own state.json. Tests that need a specific state file still set
 * UPEC_WIPE_STATE_PATH or call setTestStatePath themselves.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

test('the test preload gives this process a temp state path, not the repo state.json', () => {
  const p = process.env.UPEC_WIPE_STATE_PATH;
  assert.ok(p, 'UPEC_WIPE_STATE_PATH is set by the preload');
  assert.ok(path.resolve(p).startsWith(path.resolve(os.tmpdir())), `${p} is under the OS temp dir`);
  assert.notEqual(path.resolve(p), path.resolve(__dirname, '..', 'state.json'));
  assert.equal(require('../lib/config').STATE_PATH, path.resolve(p));
});

test('each test file under one `node --test` run gets its own state path', () => {
  const fs = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-iso-'));
  try {
    for (const n of ['a', 'b']) {
      fs.writeFileSync(path.join(dir, `${n}.test.js`),
        `require('node:test')('p', () => { require('node:fs').writeFileSync(${JSON.stringify(path.join(dir, n + '.out'))}, process.env.UPEC_WIPE_STATE_PATH || ''); });\n`);
    }
    // A fresh run, as npm test starts one: drop this process's preload state.
    const env = { ...process.env };
    for (const k of ['UPEC_WIPE_STATE_PATH', 'UPEC_WIPE_TEST_STATE_AUTO', 'UPEC_WIPE_TEST_STATE_ROOT_PID', 'NODE_TEST_CONTEXT']) delete env[k];
    const preload = path.join(__dirname, 'helpers', 'egress-off.js');
    const r = spawnSync(process.execPath, ['--require', preload, '--test', path.join(dir, 'a.test.js'), path.join(dir, 'b.test.js')], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const a = fs.readFileSync(path.join(dir, 'a.out'), 'utf8');
    const b = fs.readFileSync(path.join(dir, 'b.out'), 'utf8');
    assert.ok(a && b, 'both files saw a state path');
    assert.notEqual(a, b, 'test files must not share a state file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an explicit UPEC_WIPE_STATE_PATH set by a test is passed to its children unchanged', () => {
  const { spawnSync } = require('node:child_process');
  const explicit = path.join(os.tmpdir(), 'upec-wipe-explicit-state.json');
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.env.UPEC_WIPE_STATE_PATH)'], {
    env: { ...process.env, UPEC_WIPE_STATE_PATH: explicit }, encoding: 'utf8',
  });
  assert.equal(r.stdout, explicit);
});
