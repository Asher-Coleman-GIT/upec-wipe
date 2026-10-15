'use strict';
/**
 * test/banner.test.js - the UPEC-WIPE banner: the utahupec.org logo (wifi bands
 * over a red U) as the U of UPEC-WIPE, on --help and at the start of a run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RED = '\x1b[38;2;190;0;0m';
const RESET = '\x1b[0m';

const PLAIN = [
  '',
  '',
  '▄▀▀▀▀▀▄',
  ' ▄▀▀▀▄',
  '  ▄▀▄',
  '',
  ' █   █  ████  █████  ████       █   █ ███ ████  █████',
  ' █   █  █   █ █     █           █   █  █  █   █ █',
  ' █   █  ████  ████  █     ████  █ █ █  █  ████  ████',
  ' █   █  █     █     █           ██ ██  █  █     █',
  ' █████  █     █████  ████       █   █ ███ █     █████',
  '        Web Identity Purge Engine',
].join('\n');

test('the plain banner is exactly the agreed art, and fits 80 columns', () => {
  const { renderBanner } = require('../lib/banner');
  assert.equal(renderBanner({ color: false }), PLAIN);
  for (const line of PLAIN.split('\n')) assert.ok(line.length <= 80, line);
});

test('with color, only the U is red', () => {
  const { renderBanner } = require('../lib/banner');
  const lines = renderBanner({ color: true }).split('\n');
  const plain = PLAIN.split('\n');
  for (const i of [0, 1, 2, 3, 4, 5, 11]) assert.equal(lines[i], plain[i], `row ${i} has no color`);
  for (let i = 6; i <= 10; i++) {
    const u = plain[i].slice(1, 6);
    assert.equal(lines[i], ' ' + RED + u + RESET + plain[i].slice(6), `row ${i}`);
  }
});

test('color only on a real terminal, without NO_COLOR, and not on a dumb TERM', () => {
  const { useColor } = require('../lib/banner');
  assert.equal(useColor({ isTTY: true, env: {} }), true);
  assert.equal(useColor({ isTTY: false, env: {} }), false);
  assert.equal(useColor({ isTTY: true, env: { NO_COLOR: '1' } }), false);
  assert.equal(useColor({ isTTY: true, env: { NO_COLOR: '' } }), true, 'no-color.org: only a non-empty NO_COLOR counts');
  assert.equal(useColor({ isTTY: true, env: { TERM: 'dumb' } }), false);
});

test('--help starts with the banner, plain when piped', () => {
  const { makeFixtureRepo, runIn } = require('./helpers/fixture-repo');
  const dir = makeFixtureRepo();
  try {
    for (const args of [['--help'], []]) {
      const r = runIn(dir, 'bin/upec-wipe.js', args);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.startsWith(PLAIN + '\n'), r.stdout.slice(0, 200));
      assert.doesNotMatch(r.stdout, /\x1b\[/);
      assert.match(r.stdout, /Usage: upec-wipe/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a run prints the banner only on a terminal, before the start line', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'modes', 'run.js'), 'utf8');
  const at = src.indexOf('if (process.stdout.isTTY) console.log(renderBanner({ color: useColor() }));');
  assert.ok(at > 0, 'run.js prints the banner behind an isTTY check');
  assert.ok(at < src.indexOf("console.log('\\nUPEC-WIPE - starting run');"), 'before the start line');
});

test('help keeps the description line, drops the repeated title and the examples', () => {
  const { buildHelp } = require('../lib/cli-map');
  const help = buildHelp();
  assert.ok(help.startsWith('data-broker opt-out and privacy requests\n\nUsage: upec-wipe <command> [options]'), help.slice(0, 80));
  assert.doesNotMatch(help, /Web Identity Purge Engine\) -/);
  assert.doesNotMatch(help, /^Examples:/m);
});

const WORKFLOW = ['setup', 'doctor', 'preview', 'run', 'pending', 'manual', 'done', 'reply', 'verify', 'list', 'web-check', 'clear', 'clear-all'];

test('help lists the commands in workflow order', () => {
  const { buildHelp } = require('../lib/cli-map');
  const listed = buildHelp().split('\n').map(l => (l.match(/^  ([a-z-]+)\s{2,}/) || [])[1]).filter(Boolean);
  assert.deepEqual(listed, WORKFLOW);
});

test('the README and the manual list the commands in the same order', () => {
  for (const f of ['README.md', 'docs/UPEC-MANUAL.md']) {
    const rows = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')
      .map(l => (l.match(/^\| `([a-z-]+)(?: --email)?` \|/) || [])[1]).filter(Boolean);
    const order = rows.filter((c, i) => WORKFLOW.includes(c) && rows.indexOf(c) === i);
    assert.deepEqual(order, WORKFLOW, f);
  }
});
