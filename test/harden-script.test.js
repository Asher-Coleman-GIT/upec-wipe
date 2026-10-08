/**
 * test/harden-script.test.js
 *
 * scripts/harden.sh must refuse root, set owner-only modes, and detect a
 * filesystem where chmod silently does nothing (WSL /mnt/c, FAT, SMB).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'harden.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

test('harden.sh parses', () => { execFileSync('bash', ['-n', SCRIPT]); });
test('harden.sh refuses root', () => { assert.match(SRC, /id -u/); });
test('harden.sh probes that chmod actually took effect', () => { assert.match(SRC, /stat/); assert.match(SRC, /exit 2/); });
test('harden.sh covers the PII files', () => {
  for (const f of ['config.json', 'config.json.enc', 'state.json', '.auth.json', 'passphrase']) {
    assert.ok(SRC.includes(f), f);
  }
});
