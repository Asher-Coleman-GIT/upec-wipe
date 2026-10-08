/**
 * test/upec-docs.test.js
 *
 * The club docs must exist and mention every safety setting by its real name,
 * so a rename in code breaks this test instead of silently stranding members.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('manual covers each platform section', () => {
  const m = read('docs/UPEC-MANUAL.md');
  for (const h of ['## Part A: Windows (WSL2)', '## Part B: Linux', '## Part C: Docker', '## Part D: Every month', '## Troubleshooting']) {
    assert.ok(m.includes(h), h);
  }
});

test('manual names every safety setting exactly', () => {
  const m = read('docs/UPEC-MANUAL.md');
  for (const s of ['"required": true', 'smtp', '"from"', 'network', 'AIDR_PASSPHRASE_FILE', 'scripts/harden.sh', 'aidr preview', 'Lockdown mode', '/mnt/c']) {
    assert.ok(m.includes(s), s);
  }
});

test('threat model states the limits', () => {
  const t = read('docs/THREAT-MODEL.md');
  for (const s of ['does not protect', 'one instance per member', 'CapSolver', 'generic']) {
    assert.ok(t.toLowerCase().includes(s.toLowerCase()), s);
  }
});
