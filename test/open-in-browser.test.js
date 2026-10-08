/**
 * test/open-in-browser.test.js
 *
 * Covers lib/notify.js openInBrowser, the only export left after the fork
 * removed notifications. child_process.spawn is stubbed; nothing is launched.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');
const notify = require('../lib/notify');

function stubSpawn() {
  const calls = [];
  const orig = childProcess.spawn;
  childProcess.spawn = (cmd, args, opts) => {
    calls.push({ cmd, args: args || [], opts });
    return { unref: () => {} };
  };
  return { calls, restore: () => { childProcess.spawn = orig; } };
}

test('openInBrowser: calls open for each URL on darwin', () => {
  const { calls, restore } = stubSpawn();
  notify.openInBrowser(['https://a.com', 'https://b.com'], 'darwin');
  restore();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, 'open');
  assert.ok(calls[0].args.includes('https://a.com'));
  assert.equal(calls[1].cmd, 'open');
  assert.ok(calls[1].args.includes('https://b.com'));
});

test('openInBrowser: on linux calls xdg-open for each URL', () => {
  const { calls, restore } = stubSpawn();
  notify.openInBrowser(['https://a.com', 'https://b.com'], 'linux');
  restore();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, 'xdg-open');
  assert.ok(calls[0].args.includes('https://a.com'));
  assert.equal(calls[1].cmd, 'xdg-open');
  assert.ok(calls[1].args.includes('https://b.com'));
});

test('openInBrowser: on win32 uses cmd /c start with empty title before the URL', () => {
  const { calls, restore } = stubSpawn();
  notify.openInBrowser(['https://example.com'], 'win32');
  restore();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'cmd');
  assert.ok(calls[0].args.includes('/c'));
  assert.ok(calls[0].args.includes('start'));
  const urlIdx = calls[0].args.indexOf('https://example.com');
  const emptyIdx = calls[0].args.indexOf('');
  assert.ok(emptyIdx !== -1 && emptyIdx < urlIdx);
});

test('openInBrowser: swallows spawn errors and does not throw', () => {
  const orig = childProcess.spawn;
  childProcess.spawn = () => { throw new Error('spawn failed'); };
  try {
    for (const p of ['linux', 'win32', 'darwin']) {
      assert.doesNotThrow(() => notify.openInBrowser(['https://a.com'], p));
    }
  } finally {
    childProcess.spawn = orig;
  }
});
