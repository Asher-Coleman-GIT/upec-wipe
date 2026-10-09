/**
 * test/open-in-browser.test.js
 *
 * Covers lib/notify.js openInBrowser and isSafeUrl. child_process.spawn is
 * stubbed; nothing is launched.
 *
 * Audit M4: on win32 the URL went through `cmd /c start`, where & | ^ run
 * commands. URLs can be page-supplied (DSAR links) or registry rows, so every
 * URL is validated on every OS and win32 uses rundll32 without a shell.
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

test('openInBrowser: on win32 uses rundll32 url.dll,FileProtocolHandler, never cmd (audit M4)', () => {
  const { calls, restore } = stubSpawn();
  notify.openInBrowser(['https://example.com/a?b=1'], 'win32');
  restore();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'rundll32');
  assert.deepEqual(calls[0].args, ['url.dll,FileProtocolHandler', 'https://example.com/a?b=1']);
  assert.notEqual(calls[0].cmd, 'cmd');
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

// -- Audit M4: URL validation -------------------------------------------------

function captureConsole(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { Object.assign(console, orig); }
  return lines;
}

test('isSafeUrl accepts plain http and https URLs', () => {
  assert.equal(notify.isSafeUrl('https://example.com/opt-out?id=1'), true);
  assert.equal(notify.isSafeUrl('http://example.com/'), true);
});

test('isSafeUrl rejects non-http(s) protocols and unparseable input', () => {
  for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://x.example/', 'mailto:a@b.example', 'not a url', '', null, undefined, 42]) {
    assert.equal(notify.isSafeUrl(u), false, String(u));
  }
});

test('isSafeUrl rejects shell metacharacters, quotes and whitespace', () => {
  const bad = ['&', '|', '^', '<', '>', '"', '`', "'", ' ', '\t', '\n'];
  for (const ch of bad) {
    assert.equal(notify.isSafeUrl(`https://x.example/a${ch}calc`), false, JSON.stringify(ch));
  }
});

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`openInBrowser on ${platform}: an unsafe URL is never passed to a process`, () => {
    const { calls, restore } = stubSpawn();
    let lines;
    try {
      lines = captureConsole(() => notify.openInBrowser(['https://a.example/x&whoami', 'https://ok.example/y'], platform));
    } finally { restore(); }
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes('https://ok.example/y'));
    for (const c of calls) assert.ok(!c.args.some(a => String(a).includes('whoami')));
    const out = lines.join('\n');
    assert.match(out, /not opened: unsafe URL/);
    assert.match(out, /a\.example/);
    assert.doesNotMatch(out, /whoami/, 'only the host is printed');
  });
}
