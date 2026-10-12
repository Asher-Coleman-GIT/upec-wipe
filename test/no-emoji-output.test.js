'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PICTO = /\p{Extended_Pictographic}/u;

test('no emoji in tracked source outside tests and the dashboard UI', () => {
  const files = execFileSync('git', ['ls-files', '-z', '*.js'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(f => f && !f.startsWith('test/') && !f.startsWith('dashboard/public/') && !f.endsWith('.test.js'));
  const offenders = [];
  for (const f of files) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (PICTO.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
