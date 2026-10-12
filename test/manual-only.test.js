/**
 * test/manual-only.test.js
 *
 * This fork runs only when the member starts it. Nothing may register a
 * scheduled job (systemd timer, crontab, launchd, schtasks), and the passphrase
 * hand-off that existed only for the scheduled systemd unit is gone.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the scheduler module is gone', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'lib', 'scheduler.js')), false);
});

test('setup does not offer to schedule a run', () => {
  const src = read('setup.js');
  assert.doesNotMatch(src, /scheduler|installSchedule|Monthly Schedule/);
});

test('watcher refuses --install-scheduler instead of starting a real run', () => {
  assert.doesNotMatch(read('watcher.js'), /INSTALL_SCHEDULER|lib\/scheduler/);
  const { resolveMode } = require('../lib/mode-dispatch');
  assert.notEqual(resolveMode({ installScheduler: true }).mode, 'install-scheduler');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'watcher.js'), '--install-scheduler'],
    { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--install-scheduler was removed/);
});

test('dashboard has no schedule route or tab', () => {
  assert.doesNotMatch(read('dashboard/server.js'), /\/api\/schedule|systemctl/);
  assert.doesNotMatch(read('dashboard/public/index.html'), /tab-schedule/);
  assert.doesNotMatch(read('dashboard/public/app.js'), /schedule/i);
});

test('a systemd CREDENTIALS_DIRECTORY no longer supplies the passphrase', () => {
  const { getPassphrase } = require('../lib/config');
  const cred = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-cred-'));
  fs.writeFileSync(path.join(cred, 'upec-wipe-passphrase'), 'fromcred');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-home-'));
  assert.equal(getPassphrase(undefined, { CREDENTIALS_DIRECTORY: cred }, home), '');
});
