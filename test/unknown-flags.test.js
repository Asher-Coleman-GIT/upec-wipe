/**
 * test/unknown-flags.test.js
 *
 * An unknown flag refuses before any config is read: a typo such as
 * `run --emial` used to be ignored and start a real web-form run.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkUnknownFlags, KNOWN_FLAGS } = require('../lib/cli-flags');

const ROOT = path.join(__dirname, '..');
const argv = (...a) => ['node', 'watcher.js', ...a];

test('a misspelled flag is refused with the nearest known flag', () => {
  assert.equal(checkUnknownFlags(argv('--emial')), '--emial is not a valid flag (did you mean --email?).');
  assert.equal(checkUnknownFlags(argv('--asist', '--only', 'Pipl')), '--asist is not a valid flag (did you mean --assist?).');
});

test('a flag nothing is close to is refused without a guess', () => {
  assert.equal(checkUnknownFlags(argv('--frobnicate')), '--frobnicate is not a valid flag. Run upec-wipe --help for the commands.');
});

test('known flags, their values and plain arguments pass', () => {
  assert.equal(checkUnknownFlags(argv('--email', '--only', 'Pipl,Spokeo (email)')), null);
  assert.equal(checkUnknownFlags(argv('--preview', '--assist', '--skip', 'Radaris')), null);
  assert.equal(checkUnknownFlags(argv('--reply', 'Pipl', 'honored')), null);
  assert.equal(checkUnknownFlags(argv('--done', 'Spokeo', 'USPhonebook')), null);
  assert.equal(checkUnknownFlags(argv('--manual', '--import-last-run')), null);
  assert.equal(checkUnknownFlags(argv('doctor')), null);
  assert.equal(checkUnknownFlags(argv()), null);
});

test('every flag the watcher code reads is a known flag', () => {
  const files = ['watcher.js', 'lib/cli-flags.js', 'lib/allowlist-edit.js',
    ...fs.readdirSync(path.join(ROOT, 'lib/modes')).map(f => `lib/modes/${f}`)];
  // Refused on purpose before the unknown-flag check, with their own message.
  const refused = new Set(['--pollute', '--install-scheduler']);
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/(?:has|includes|indexOf|find|valueAfter)\((?:argv, )?'(--[a-z][a-z0-9-]*)'/g)) {
      if (refused.has(m[1])) continue;
      assert.ok(KNOWN_FLAGS.has(m[1]), `${f} reads ${m[1]}, which is not in KNOWN_FLAGS`);
    }
  }
});

// Spawned in a config-free copy of the repo: a broken refusal must never fall
// through to a real run with the member's config.
const { makeFixtureRepo, runIn } = require('./helpers/fixture-repo');
const FIXTURE = makeFixtureRepo();
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));

test('upec-wipe run --emial refuses before any work', () => {
  const r = runIn(FIXTURE, 'bin/upec-wipe.js', ['run', '--emial']);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 1, out);
  assert.match(out, /--emial is not a valid flag \(did you mean --email\?\)/);
  assert.doesNotMatch(out, /BROWSER_MODULE_LOADED/);
});

test('a retired flag keeps its own message', () => {
  const r = runIn(FIXTURE, 'watcher.js', ['--generic']);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 1);
  assert.match(out, /generic pass was retired/);
});

// 2026-10-15: `run --only --assist "A,B"` took "--assist" as the list, matched
// nothing and ran an empty pass; the real list was ignored.
test('a value flag followed by another flag, or by nothing, is refused', () => {
  assert.match(checkUnknownFlags(argv('--only', '--assist', 'Adstra,Wiland')), /^--only needs a value right after it/);
  assert.match(checkUnknownFlags(argv('--assist', '--only')), /^--only needs a value right after it/);
  assert.match(checkUnknownFlags(argv('--skip', '--preview')), /^--skip needs a value/);
  assert.match(checkUnknownFlags(argv('--read-email', '--since')), /^--since needs a value/);
  assert.equal(checkUnknownFlags(argv('--assist', '--only', 'Adstra,Wiland')), null);
});
