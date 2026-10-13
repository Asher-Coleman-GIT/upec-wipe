/**
 * test/no-notifications.test.js
 *
 * Fork decision: results never leave the machine as a notification (no
 * iMessage, desktop toast, webhook or emailed report).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { modeFiles } = require('./helpers/watcher-source');
const SOURCES = ['watcher.js', ...modeFiles(), 'setup.js', 'lib/notify.js', 'lib/serp-watch.js'];

test('lib/notify.js only exports openInBrowser and isSafeUrl', () => {
  assert.deepEqual(Object.keys(require('../lib/notify')).sort(), ['isSafeUrl', 'openInBrowser']);
});

test('no source references a notification channel', () => {
  for (const rel of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const word of ['sendText', 'desktopNotify', 'macNotify', 'dispatchNotify', '_webhookPost', 'emailReportTo', 'osascript', 'notify-send', 'textTo']) {
      assert.ok(!src.includes(word), `${rel} still references ${word}`);
    }
  }
});

test('config.example.json has no notify block', () => {
  assert.equal('notify' in require('../config.example.json'), false);
});
