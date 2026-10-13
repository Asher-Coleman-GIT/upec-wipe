'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWatcherFlags } = require('../lib/cli-flags');

const p = (...args) => parseWatcherFlags(['node', 'watcher.js', ...args]);

test('a plain run fills forms and sends no email', () => {
  const f = p();
  assert.equal(f.EMAIL, false);
  assert.equal(f.FORMS, true);
  assert.equal(f.DRY_RUN, false);
});

test('--email alone sends email and fills no forms; --forms adds them back', () => {
  assert.equal(p('--email').FORMS, false);
  assert.equal(p('--email', '--forms').FORMS, true);
});

test('--preview implies a dry run', () => {
  assert.equal(p('--preview').DRY_RUN, true);
});

test('value flags take the next argument', () => {
  assert.equal(p('--only', 'Spokeo').ONLY_ARG, 'Spokeo');
  assert.equal(p().ONLY_ARG, null);
  assert.equal(p('--skip', 'Radaris').SKIP_ARG, 'Radaris');
});

test('doctor as the first argument or as a flag', () => {
  assert.equal(p('doctor').DOCTOR, true);
  assert.equal(p('--doctor').DOCTOR, true);
});

test('--allow is parsed', () => {
  assert.equal(p('--allow', 'Spokeo').ALLOWLIST_CMD.name, 'Spokeo');
  assert.equal(p().ALLOWLIST_CMD, null);
});

test('replyArgs: the broker and outcome after --reply, skipping flags and flag values', () => {
  const { replyArgs } = require('../lib/cli-flags');
  const r = (...a) => replyArgs(['node', 'watcher.js', '--reply', ...a]);
  assert.deepEqual(r('Pipl', 'honored'), { query: 'Pipl', outcome: 'honored', extra: false });
  assert.deepEqual(r('--resume', 'Pipl', 'bounced'), { query: 'Pipl', outcome: 'bounced', extra: false });
  assert.deepEqual(r('--only', 'Acme', 'Pipl', 'honored'), { query: 'Pipl', outcome: 'honored', extra: false });
  assert.deepEqual(r('Pipl', '--skip', 'none', 'refused'), { query: 'Pipl', outcome: 'refused', extra: false });
  assert.deepEqual(r(), { query: '', outcome: '', extra: false });
});

test('replyArgs: a third plain argument is reported, and a bare flag takes no value', () => {
  const { replyArgs } = require('../lib/cli-flags');
  const r = (...a) => replyArgs(['node', 'watcher.js', '--reply', ...a]);
  assert.equal(r('Pipl', 'Spokeo', 'honored').extra, true);
  assert.equal(r('Pipl', 'honored').extra, false);
  assert.deepEqual(r('--resume', 'Pipl', 'honored'), { query: 'Pipl', outcome: 'honored', extra: false });
});
