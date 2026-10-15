/**
 * test/cli-map.test.js
 *
 * Pure unit tests for the upec-wipe CLI argument-to-target mapping. No spawning,
 * no network, no filesystem - resolveCommand is a pure function.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCommand, COMMANDS, buildHelp } = require('../lib/cli-map');

test('resolveCommand: no args resolves to help', () => {
  const r = resolveCommand([]);
  assert.equal(r.ok, true);
  assert.equal(r.target, 'help');
});

test('resolveCommand: --help and -h resolve to help', () => {
  for (const flag of ['--help', '-h', 'help']) {
    const r = resolveCommand([flag]);
    assert.equal(r.target, 'help', `${flag} should map to help`);
  }
});

test('resolveCommand: --version and -v resolve to version', () => {
  for (const flag of ['--version', '-v']) {
    const r = resolveCommand([flag]);
    assert.equal(r.target, 'version', `${flag} should map to version`);
  }
});

test('resolveCommand: setup maps to node setup.js with no flags', () => {
  const r = resolveCommand(['setup']);
  assert.equal(r.ok, true);
  assert.equal(r.target, 'node');
  assert.equal(r.file, 'setup.js');
  assert.deepEqual(r.args, ['setup.js']);
  assert.equal(r.cwd, 'root');
  assert.equal(r.command, 'setup');
});

test('resolveCommand: run maps to node watcher.js (real run, no flag)', () => {
  const r = resolveCommand(['run']);
  assert.equal(r.file, 'watcher.js');
  assert.deepEqual(r.args, ['watcher.js']);
});

test('resolveCommand: preview maps to watcher.js --preview', () => {
  const r = resolveCommand(['preview']);
  assert.deepEqual(r.args, ['watcher.js', '--preview']);
});

test('resolveCommand: verify maps to watcher.js --verify', () => {
  const r = resolveCommand(['verify']);
  assert.deepEqual(r.args, ['watcher.js', '--verify']);
});

test('resolveCommand: doctor maps to watcher.js --doctor', () => {
  const r = resolveCommand(['doctor']);
  assert.deepEqual(r.args, ['watcher.js', '--doctor']);
});

test('resolveCommand: pending maps to watcher.js --pending', () => {
  assert.deepEqual(resolveCommand(['pending']).args, ['watcher.js', '--pending']);
});

test('resolveCommand: a hyphenated subcommand passes through extra args', () => {
  const r = resolveCommand(['web-check', '--only', 'Spokeo']);
  assert.deepEqual(r.args, ['watcher.js', '--web-check', '--only', 'Spokeo']);
});

test('resolveCommand: extra args are passed through after the mapped flags', () => {
  const r = resolveCommand(['run', '--dry-run', '--only', 'Spokeo']);
  assert.deepEqual(r.args, ['watcher.js', '--dry-run', '--only', 'Spokeo']);
});

test('resolveCommand: preview passthrough keeps mapped flag first', () => {
  const r = resolveCommand(['preview', '--only', 'BeenVerified']);
  assert.deepEqual(r.args, ['watcher.js', '--preview', '--only', 'BeenVerified']);
});

test('resolveCommand: unknown command fails and falls back to help', () => {
  const r = resolveCommand(['frobnicate']);
  assert.equal(r.ok, false);
  assert.equal(r.target, 'help');
  assert.match(r.error, /unknown command: frobnicate/);
});

test('COMMANDS lists every public subcommand with a description', () => {
  const expected = ['setup', 'run', 'preview', 'verify', 'pending', 'manual', 'done', 'web-check', 'list', 'reply', 'doctor'];
  for (const name of expected) {
    assert.ok(COMMANDS[name], `COMMANDS must include ${name}`);
    assert.equal(typeof COMMANDS[name].desc, 'string');
    assert.ok(COMMANDS[name].desc.length > 0, `${name} must have a non-empty description`);
  }
});

test('buildHelp renders the program name and every subcommand', () => {
  const help = buildHelp();
  assert.match(help, /upec-wipe/);
  for (const name of ['setup', 'run', 'preview', 'verify', 'web-check', 'reply', 'doctor']) {
    assert.match(help, new RegExp(`\\b${name}\\b`), `help must mention ${name}`);
  }
});

test('L9: the web-check description does not promise email or alerts', () => {
  assert.equal(COMMANDS['web-check'].desc, 'Search DuckDuckGo and Google for your name and list the broker sites that show it');
  assert.doesNotMatch(buildHelp(), /alert|email report/i);
});

test('reply maps to watcher --reply and passes the arguments through', () => {
  const { resolveCommand } = require('../lib/cli-map');
  const r = resolveCommand(['reply', 'Claritas', 'honored']);
  assert.equal(r.ok, true);
  assert.equal(r.file, 'watcher.js');
  assert.deepEqual(r.args.slice(-3), ['--reply', 'Claritas', 'honored']);
});

test('manual and done map to watcher --manual / --done and pass the arguments through', () => {
  assert.deepEqual(resolveCommand(['manual']).args, ['watcher.js', '--manual']);
  assert.deepEqual(resolveCommand(['done', 'Search People Free']).args, ['watcher.js', '--done', 'Search People Free']);
});

test('upec-wipe read-email maps to watcher.js --read-email and passes --since', () => {
  const r = resolveCommand(['read-email', '--since', '2026-10-01']);
  assert.deepEqual(r.args, ['watcher.js', '--read-email', '--since', '2026-10-01']);
  assert.match(COMMANDS['read-email'].desc, /read-only/i);
});
