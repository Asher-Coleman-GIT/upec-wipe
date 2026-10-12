/**
 * test/pollute-disabled.test.js
 *
 * Audit M1 (follow-up C1 item 2). Noise mode (`--pollute N`) filled the
 * "bogus" forms from the module-default broker list, which is built from the
 * real person, so it submitted the member's real name (and alias) N times and
 * could mark real opt-outs as done. The fork disables the flag: it prints one
 * line and exits 1 before any browser module is loaded.
 *
 * The child runs with a preload that reports any require of playwright, so the
 * test proves the browser is never reached.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WATCHER = path.join(ROOT, 'watcher.js');
const MSG = '--pollute is disabled in this fork: it submitted real personal data. See docs/THREAT-MODEL.md.';

function runWatcher(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-pollute-'));
  const preload = path.join(dir, 'trap.js');
  fs.writeFileSync(preload, [
    "'use strict';",
    "const Module = require('module');",
    'const orig = Module._load;',
    'Module._load = function (req, ...rest) {',
    // The package itself, not ./lib/playwright-loader (which loads it lazily).
    "  if (/^playwright(-core)?(\\/|$)/.test(String(req))) process.stderr.write('BROWSER_MODULE_LOADED\\n');",
    '  return orig.call(this, req, ...rest);',
    '};',
  ].join('\n'));
  try {
    return spawnSync(process.execPath, ['-r', preload, WATCHER, ...args], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('watcher --pollute 1 prints the disabled line and exits non-zero', () => {
  const r = runWatcher(['--pollute', '1']);
  assert.notEqual(r.status, 0);
  assert.equal(r.status, 1);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.includes(MSG), `expected the disabled message, got:\n${out}`);
  assert.doesNotMatch(out, /BROWSER_MODULE_LOADED/);
  assert.doesNotMatch(out, /NOISE MODE|bogus/i);
});

test('watcher --pollute with --dry-run is refused the same way', () => {
  const r = runWatcher(['--dry-run', '--pollute', '3']);
  assert.equal(r.status, 1);
  assert.ok(((r.stdout || '') + (r.stderr || '')).includes(MSG));
});

test('watcher.js has no runnable noise branch', () => {
  const src = fs.readFileSync(WATCHER, 'utf8');
  assert.doesNotMatch(src, /generateBogusPerson/);
  assert.doesNotMatch(src, /POLLUTE_COUNT/);
});

test('README has no --pollute section', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /--pollute/);
  assert.doesNotMatch(readme, /noise mode/i);
});
