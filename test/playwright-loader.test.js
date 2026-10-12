'use strict';
/*
 * test/playwright-loader.test.js - audit L6: no home-directory Playwright fallback.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadChromium } = require('../lib/playwright-loader');
const { modeFiles } = require('./helpers/watcher-source');

test('L6: missing playwright fails with the install hint and requires nothing else', () => {
  const seen = [];
  const req = (id) => { seen.push(id); throw new Error('Cannot find module'); };
  assert.throws(() => loadChromium(req), (e) => {
    assert.match(e.message, /npm ci --ignore-scripts && npx playwright install chromium/);
    assert.equal(e.code, 'PLAYWRIGHT_MISSING');
    return true;
  });
  assert.deepEqual(seen, ['playwright']);
});

test('L6: present playwright returns chromium', () => {
  assert.equal(loadChromium(() => ({ chromium: 'C' })), 'C');
});

test('L6: no source file mentions the home-dir plugin fallback', () => {
  for (const f of ['watcher.js', ...modeFiles(), 'generic-runner.js', 'setup.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.equal(/openclaw/i.test(src), false, f);
  }
});
