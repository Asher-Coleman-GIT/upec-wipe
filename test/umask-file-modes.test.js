/**
 * test/umask-file-modes.test.js
 *
 * Audit M2 (follow-up C1 item 3). Only run.sh and harden.sh set a umask, so
 * launching through bin/aidr.js (the documented entry point), watcher.js,
 * setup.js or the dashboard directly created run logs, audit files (full name
 * and real email), complaints, snapshots and reports 0644 and their dirs 0755.
 * `--allow/--unallow` also rewrote config.json through a default-mode tmp file,
 * turning setup's 0600 into 0644.
 *
 * - Each entry point leaves the process umask at 077, even when launched
 *   under umask 022.
 * - `watcher.js --allow X` on a fixture copy of the repo (in os.tmpdir(), since
 *   chmod is a no-op on /mnt/c) leaves config.json at 0600.
 * - Every log/data mkdirSync passes mode 0o700, and writeAuditFile creates a
 *   0700 dir even under umask 022.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = process.platform === 'win32';

function modeOf(p) { return fs.statSync(p).mode & 0o777; }

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

// Spawn `node <args>` under umask 022 with a preload that reports the umask the
// process ended with.
function umaskAfter(nodeArgs, opts) {
  const dir = mkTmp('aidr-umask-');
  const preload = path.join(dir, 'report-umask.js');
  fs.writeFileSync(preload,
    "process.on('exit', () => { process.stderr.write('UMASK=' + process.umask().toString(8) + '\\n'); });\n");
  const quoted = [process.execPath, '-r', preload, ...nodeArgs].map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
  try {
    const r = spawnSync('sh', ['-c', `umask 022; exec ${quoted} </dev/null`], {
      encoding: 'utf8',
      timeout: 30000,
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'test', HOME: dir, ...(opts && opts.env) },
    });
    const m = /UMASK=(\d+)/.exec(r.stderr || '');
    return { umask: m ? parseInt(m[1], 8) : null, r };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('bin/aidr.js sets umask 077', { skip: SKIP }, () => {
  const { umask, r } = umaskAfter([path.join(ROOT, 'bin', 'aidr.js'), '--help']);
  assert.equal(umask, 0o077, r.stderr);
});

test('watcher.js sets umask 077', { skip: SKIP }, () => {
  const { umask, r } = umaskAfter([path.join(ROOT, 'watcher.js'), '--pollute', '1']);
  assert.equal(umask, 0o077, r.stderr);
});

test('setup.js sets umask 077 (on require, before main)', { skip: SKIP }, () => {
  const { umask, r } = umaskAfter(['-e', `require(${JSON.stringify(path.join(ROOT, 'setup.js'))})`]);
  assert.equal(umask, 0o077, r.stderr);
});

test('dashboard/server.js sets umask 077 (on require)', { skip: SKIP }, () => {
  const { umask, r } = umaskAfter(['-e', `require(${JSON.stringify(path.join(ROOT, 'dashboard', 'server.js'))})`],
    { env: { AIDR_USER: 'u', AIDR_PASS: 'p'.repeat(16) } });
  assert.equal(umask, 0o077, r.stderr);
});

test('umask call sits at the top of each entry point, before any require', () => {
  for (const rel of ['bin/aidr.js', 'watcher.js', 'setup.js', 'dashboard/server.js']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const u = src.indexOf('process.umask(0o077)');
    assert.ok(u > 0, `${rel} must call process.umask(0o077)`);
    const firstRequire = src.search(/\brequire\(/);
    assert.ok(u < firstRequire, `${rel}: umask must come before the first require`);
  }
});

// Build a minimal copy of the repo under os.tmpdir() so watcher.js resolves
// CONFIG_PATH to a Linux-fs file whose mode can be checked.
function makeFixtureRepo() {
  const dir = mkTmp('aidr-fixture-');
  for (const f of ['watcher.js', 'brokers.js', 'generic-runner.js', 'package.json']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  for (const d of ['lib', 'data']) fs.cpSync(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  return dir;
}

test('watcher --allow X keeps config.json at 0600 under umask 022', { skip: SKIP }, () => {
  const dir = makeFixtureRepo();
  try {
    const cfg = path.join(dir, 'config.json');
    fs.writeFileSync(cfg, JSON.stringify({ person: { firstName: 'A' } }), { mode: 0o600 });
    fs.chmodSync(cfg, 0o600);
    const r = spawnSync('sh', ['-c', `umask 022; exec '${process.execPath}' '${path.join(dir, 'watcher.js')}' --allow Spokeo`], {
      encoding: 'utf8', timeout: 30000, cwd: dir,
      env: { ...process.env, NODE_ENV: 'test', HOME: dir, AIDR_STATE_PATH: path.join(dir, 'state.json') },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')).allowlist, ['Spokeo']);
    assert.equal(modeOf(cfg), 0o600);
    assert.equal(fs.existsSync(cfg + '.tmp'), false);

    const r2 = spawnSync('sh', ['-c', `umask 022; exec '${process.execPath}' '${path.join(dir, 'watcher.js')}' --unallow Spokeo`], {
      encoding: 'utf8', timeout: 30000, cwd: dir,
      env: { ...process.env, NODE_ENV: 'test', HOME: dir, AIDR_STATE_PATH: path.join(dir, 'state.json') },
    });
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(modeOf(cfg), 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every logs/ and data/ mkdirSync passes mode 0o700', () => {
  const files = ['watcher.js', 'lib/audit.js', 'lib/complaint.js', 'lib/exposure.js', 'lib/imap-confirm.js',
    'lib/serp-scan.js', 'lib/snapshot.js', 'lib/scheduler.js', 'lib/browser-session.js'];
  const offenders = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/mkdirSync\(/.test(line)) return;
      // The launchd/systemd unit dirs live outside the repo and are not PII dirs.
      if (/plistPath|unitDir/.test(line)) return;
      if (!/mode:\s*0o700/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('writeAuditFile creates its dir 0700 even under umask 022', { skip: SKIP }, () => {
  const { writeAuditFile } = require('../lib/audit');
  const base = mkTmp('aidr-audit-');
  const prev = process.umask(0o022);
  try {
    const logsDir = path.join(base, 'logs', 'nested');
    writeAuditFile(logsDir, '# x\n', '2026-01-01T00:00:00.000Z');
    assert.equal(modeOf(logsDir), 0o700);
  } finally {
    process.umask(prev);
    fs.rmSync(base, { recursive: true, force: true });
  }
});
