/**
 * test/supply-chain.test.js
 *
 * Audit section 4 (follow-up C1 item 9). Nothing in either manifest needs an
 * install script, so every project-dependency install (install.sh, the
 * Dockerfile, CI) runs `npm ci --ignore-scripts`: a compromised transitive
 * package cannot run code at install time. `npx playwright install chromium`
 * is a deliberate browser download and is left alone. The CI audit gate fails
 * on moderate advisories, not only high, for both manifests.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FILES = ['install.sh', 'Dockerfile', '.github/workflows/test.yml'];

function npmInstallLines(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*#/.test(line) && !/^\s*echo\b/.test(line))
    .filter(({ line }) => /\bnpm\s+(ci|install|i)\b/.test(line));
}

test('every npm ci / npm install of project deps passes --ignore-scripts', () => {
  const offenders = [];
  let seen = 0;
  for (const rel of FILES) {
    for (const { line, n } of npmInstallLines(rel)) {
      seen++;
      if (!/--ignore-scripts\b/.test(line)) offenders.push(`${rel}:${n}: ${line.trim()}`);
    }
  }
  assert.ok(seen >= 3, `expected the install lines to be found (saw ${seen})`);
  assert.deepEqual(offenders, []);
});

test('npx playwright install is kept without --ignore-scripts', () => {
  const src = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
  assert.match(src, /npx playwright install chromium/);
  assert.doesNotMatch(src, /playwright install[^\n]*--ignore-scripts/);
});

test('CI audit gate is --audit-level=moderate', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8');
  const audits = yml.split('\n').filter(l => /npm audit\b/.test(l) && !/^\s*#/.test(l));
  assert.equal(audits.length, 1, audits.join('\n'));
  for (const l of audits) assert.match(l, /--audit-level=moderate\b/);
  assert.doesNotMatch(yml, /--audit-level=high/);
});
