/**
 * test/generic-retired.test.js
 *
 * The generic pass was retired (docs/superpowers/specs/2026-10-13-retire-generic-pass-design.md).
 * A leftover --generic refuses before any config is read or any browser module
 * is loaded, the way --pollute does.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FLAG_MSG = 'The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.';

function runNode(script, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-generic-'));
  const preload = path.join(dir, 'trap.js');
  fs.writeFileSync(preload, [
    "'use strict';",
    "const Module = require('module');",
    'const orig = Module._load;',
    'Module._load = function (req, ...rest) {',
    "  if (/^playwright(-core)?(\\/|$)/.test(String(req))) process.stderr.write('BROWSER_MODULE_LOADED\\n');",
    '  return orig.call(this, req, ...rest);',
    '};',
  ].join('\n'));
  try {
    return spawnSync(process.execPath, ['-r', preload, script, ...args], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('watcher --generic prints the retired line and exits 1', () => {
  const r = runNode(path.join(ROOT, 'watcher.js'), ['--generic']);
  assert.equal(r.status, 1);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.includes(FLAG_MSG), `expected the retired message, got:\n${out}`);
  assert.doesNotMatch(out, /BROWSER_MODULE_LOADED/);
});

test('watcher --dry-run --generic is refused the same way', () => {
  const r = runNode(path.join(ROOT, 'watcher.js'), ['--dry-run', '--generic']);
  assert.equal(r.status, 1);
  assert.ok(((r.stdout || '') + (r.stderr || '')).includes(FLAG_MSG));
});

test('upec-wipe preview --generic is refused the same way', () => {
  const r = runNode(path.join(ROOT, 'bin', 'upec-wipe.js'), ['preview', '--generic']);
  assert.equal(r.status, 1);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.includes(FLAG_MSG), `expected the retired message, got:\n${out}`);
  assert.doesNotMatch(out, /BROWSER_MODULE_LOADED/);
});
