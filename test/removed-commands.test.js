/**
 * test/removed-commands.test.js
 *
 * docs/superpowers/specs/2026-10-13-retire-commands-design.md: every removed
 * flag and subcommand prints one line and exits 1 before any config is read or
 * any browser module loads. Spawned in a config-free copy of the repo only.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo, runIn, ROOT } = require('./helpers/fixture-repo');

const dir = makeFixtureRepo();
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

const FLAGS = {
  '--know': /^--know was removed: it cited California law \(CCPA\) for every non-EU member\. See docs\/REFERENCE\.md\.$/m,
  '--know-status': /^--know-status was removed: it cited California law \(CCPA\) for every non-EU member\. See docs\/REFERENCE\.md\.$/m,
  '--complaints': /^--complaints was removed: it cited California law \(CCPA\) for every non-EU member\. See docs\/REFERENCE\.md\.$/m,
  '--breach-check': /^--breach-check was removed: it sent your real email to Have I Been Pwned\. See docs\/REFERENCE\.md\.$/m,
  '--score': /^--score was removed: the exposure score depended on the breach check\. See docs\/REFERENCE\.md\.$/m,
  '--report': /^--report was removed: the exposure score depended on the breach check\. See docs\/REFERENCE\.md\.$/m,
  '--freeze': /^--freeze was removed: the freeze checklist is in docs\/UPEC-MANUAL\.md\.$/m,
  '--freeze-done': /^--freeze-done was removed: the freeze checklist is in docs\/UPEC-MANUAL\.md\.$/m,
  '--freeze-clear': /^--freeze-clear was removed: the freeze checklist is in docs\/UPEC-MANUAL\.md\.$/m,
  '--snapshot': /^--snapshot was removed: it saved screenshots of forms with your details\. See docs\/REFERENCE\.md\.$/m,
  '--confirm-emails': /^--confirm-emails was removed: click confirmation links yourself\. See docs\/REFERENCE\.md\.$/m,
  '--serp-scan': /^--serp-scan was removed: use upec-wipe serp-watch\.$/m,
  '--update-brokers': /^--update-brokers moved: run node scripts\/update-catalog-sources\.js\.$/m,
  '--right-to-know': /^--right-to-know was removed with the know command\. See docs\/REFERENCE\.md\.$/m,
  '--generic': /^The generic pass was retired: its sites are in the reviewed catalog \(data\/catalog\/\)\. Remove --generic\.$/m,
};

for (const [flag, msg] of Object.entries(FLAGS)) {
  for (const arg of [flag, `${flag}=x`]) {
    test(`watcher ${arg} is refused`, () => {
      const r = runIn(dir, 'watcher.js', [arg]);
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, msg);
      assert.doesNotMatch(r.stderr + r.stdout, /BROWSER_MODULE_LOADED/);
    });
  }
}

test('a removed flag passed through bin is refused', () => {
  const r = runIn(dir, 'bin/upec-wipe.js', ['run', '--know']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, FLAGS['--know']);
});

const CCPA_RE = 'was removed: it cited California law \\(CCPA\\) for every non-EU member\\. See docs\\/REFERENCE\\.md\\.$';
const COMMANDS = {
  know: new RegExp(`^know ${CCPA_RE}`, 'm'),
  'know-status': new RegExp(`^know-status ${CCPA_RE}`, 'm'),
  complaints: new RegExp(`^complaints ${CCPA_RE}`, 'm'),
  breach: /^breach was removed: it sent your real email to Have I Been Pwned\. See docs\/REFERENCE\.md\.$/m,
  score: /^score was removed: the exposure score depended on the breach check\. See docs\/REFERENCE\.md\.$/m,
  report: /^report was removed: the exposure score depended on the breach check\. See docs\/REFERENCE\.md\.$/m,
  freeze: /^freeze was removed: the freeze checklist is in docs\/UPEC-MANUAL\.md\.$/m,
  serp: /^serp was removed: use upec-wipe serp-watch\.$/m,
  dashboard: /^dashboard was removed: use the CLI; see docs\/REFERENCE\.md\.$/m,
  'update-brokers': /^update-brokers moved: run node scripts\/update-catalog-sources\.js\.$/m,
};

for (const [cmd, msg] of Object.entries(COMMANDS)) {
  test(`upec-wipe ${cmd} is refused`, () => {
    const r = runIn(dir, 'bin/upec-wipe.js', [cmd]);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, msg);
    assert.doesNotMatch(r.stderr + r.stdout, /BROWSER_MODULE_LOADED/);
  });
}

test('watcher.js checks REMOVED before parsing flags or loading a mode', () => {
  const src = fs.readFileSync(path.join(ROOT, 'watcher.js'), 'utf8');
  const check = src.indexOf('for (const { flag, message } of REMOVED)');
  assert.ok(check > 0, 'watcher.js must loop over REMOVED');
  assert.ok(check < src.indexOf('parseWatcherFlags(process.argv)'), 'before flags are parsed');
  assert.ok(check < src.indexOf('require(`./lib/modes/'), 'before any mode loads');
});
