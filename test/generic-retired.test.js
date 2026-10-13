/**
 * test/generic-retired.test.js
 *
 * The generic pass was retired (docs/superpowers/specs/2026-10-13-retire-generic-pass-design.md).
 * A leftover --generic refuses before any config is read or any browser module
 * is loaded, the way --pollute does.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FLAG_MSG = 'The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.';

const { makeFixtureRepo, runIn } = require('./helpers/fixture-repo');
const FIXTURE = makeFixtureRepo();
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));
// Spawned in a config-free copy of the repo: a broken refusal must never fall
// through to a real run with the member's config.
function runNode(script, args) {
  return runIn(FIXTURE, path.relative(ROOT, script), args);
}

test('watcher --generic prints the retired line and exits 1', () => {
  const r = runNode(path.join(ROOT, 'watcher.js'), ['--generic']);
  assert.equal(r.status, 1);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.includes(FLAG_MSG), `expected the retired message, got:\n${out}`);
  assert.doesNotMatch(out, /BROWSER_MODULE_LOADED/);
});

test('watcher --dry-run --generic is refused the same way', () => {
  const r = runNode(path.join(ROOT, 'watcher.js'), ['--dry-run', '--generic']);
  assert.equal(r.status, 1);
  assert.ok(((r.stdout || '') + (r.stderr || '')).includes(FLAG_MSG));
});

test('upec-wipe preview --generic is refused the same way', () => {
  const r = runNode(path.join(ROOT, 'bin', 'upec-wipe.js'), ['preview', '--generic']);
  assert.equal(r.status, 1);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.includes(FLAG_MSG), `expected the retired message, got:\n${out}`);
  assert.doesNotMatch(out, /BROWSER_MODULE_LOADED/);
});

const CONFIG_MSG = 'The generic pass was retired: remove the "generic" block from config.json. Its sites are in the reviewed catalog (data/catalog/).';

test('genericRetiredMessage refuses only generic.enabled === true', () => {
  const { genericRetiredMessage } = require('../lib/submission-plan');
  assert.equal(genericRetiredMessage({ generic: { enabled: true } }), CONFIG_MSG);
  assert.equal(genericRetiredMessage({ generic: { enabled: false } }), null);
  assert.equal(genericRetiredMessage({ generic: { enabled: 'true' } }), null);
  assert.equal(genericRetiredMessage({ generic: { enabled: 1 } }), null);
  assert.equal(genericRetiredMessage({}), null);
  assert.equal(genericRetiredMessage(undefined), null);
});

test('the run mode checks generic.enabled before the email step, the browser and the egress check', () => {
  const { modeSource } = require('./helpers/watcher-source');
  const src = modeSource('run');
  const check = src.indexOf('genericRetiredMessage(config)');
  assert.ok(check > 0, 'run.js must call genericRetiredMessage(config)');
  assert.ok(check > src.indexOf('loadRunSetup(flags)'), 'after the config is loaded');
  assert.ok(check < src.indexOf('loadChromium()'), 'before the browser module loads');
  assert.ok(check < src.indexOf('runEmailStep'), 'before the email step');
  assert.ok(check < src.indexOf('openBrowserSession('), 'before the egress check');
});

test('doctor flags generic.enabled: true and passes without it', async () => {
  const { checkRetiredSettings } = require('../lib/doctor');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'upec-wipe-retired-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bad = await checkRetiredSettings({ generic: { enabled: true } }, root);
  assert.equal(bad.ok, false);
  assert.equal(bad.hint, CONFIG_MSG);
  assert.equal((await checkRetiredSettings({ generic: { enabled: false } }, root)).ok, true);
  assert.equal((await checkRetiredSettings({}, root)).ok, true);
});

test('runDoctor runs the retired-settings check', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'doctor.js'), 'utf8');
  assert.match(src, /name: 'retired',\s+run: \(\) => checkRetiredSettings\(cfg, rootDir\)/);
  assert.match(src, /running 7 checks/);
});

test('generic-runner.js is gone and nothing requires it', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'generic-runner.js')), false);
  const files = ['watcher.js', 'setup.js', 'brokers.js'];
  for (const dir of ['lib', 'lib/modes', 'bin', 'scripts']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) files.push(path.join(dir, f));
  }
  for (const f of files) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /generic-runner/, `${f} still mentions generic-runner`);
  }
});

test('the run summary has no generic line and the banner counts catalog sites', () => {
  const logger = require('../lib/logger');
  logger.resetResults();
  assert.equal('genericStats' in logger.results, false);
  assert.doesNotMatch(logger.buildSummary(), /Generic/);
  const { modeSource } = require('./helpers/watcher-source');
  const src = modeSource('run');
  assert.doesNotMatch(src, /GENERIC_ENABLED|runGenericBrokers|genericStats/);
  assert.match(src, /catalogFormSiteCount\(catalogRecords\)/);
});

test('catalogFormSiteCount counts the records a forms run lists', () => {
  const { catalogFormSiteCount } = require('../lib/catalog');
  const rec = (state) => ({ domain: `${state}.example`, review: { state } });
  const records = ['reviewed', 'manual', 'needs-review', 'email', 'excluded', 'unreviewed'].map(rec);
  records.push({ domain: 'none.example' });
  assert.equal(catalogFormSiteCount(records), 3);
  assert.equal(catalogFormSiteCount(undefined), 0);
});

test('the example config has no generic block', () => {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  assert.equal('generic' in example, false);
});

test('the docs and help mention --generic only as retired', () => {
  const docs = ['README.md', 'STATUS.md', 'docs/REFERENCE.md', 'docs/UPEC-MANUAL.md', 'docs/PRIVACY.md', 'docs/THREAT-MODEL.md'];
  for (const f of docs) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const line of text.split('\n')) {
      if (!/--generic|generic\.enabled|generic-runner/.test(line)) continue;
      assert.match(line, /retired/i, `${f} mentions the generic pass without saying it was retired:\n${line}`);
    }
    assert.doesNotMatch(text, /about 490|~490/, `${f} still counts the generic sites`);
  }
  const help = runNode(path.join(ROOT, 'bin', 'upec-wipe.js'), ['--help']);
  assert.doesNotMatch(help.stdout, /--generic/);
});

test('REFERENCE says what the retired flag does now', () => {
  const ref = fs.readFileSync(path.join(ROOT, 'docs', 'REFERENCE.md'), 'utf8');
  assert.match(ref, /### Retired: the generic pass/);
  assert.match(ref, /The generic pass was retired/);
});

test('REFERENCE tells an encrypted-config member how to remove the generic block', () => {
  const ref = fs.readFileSync(path.join(ROOT, 'docs', 'REFERENCE.md'), 'utf8');
  const note = ref.slice(ref.indexOf('### Retired: the generic pass'), ref.indexOf('### Manual only'));
  assert.match(note, /--decrypt-config/);
  assert.match(note, /--encrypt-config/);
});

test('watcher --generic=1 is refused the same way', () => {
  const r = runNode(path.join(ROOT, 'watcher.js'), ['--generic=1']);
  assert.equal(r.status, 1);
  const out = (r.stdout || '') + (r.stderr || '');
  assert.ok(out.includes(FLAG_MSG), `expected the retired message, got:\n${out}`);
  assert.doesNotMatch(out, /BROWSER_MODULE_LOADED/);
});

test('REFERENCE says where the dead-site list comes from now', () => {
  const ref = fs.readFileSync(path.join(ROOT, 'docs', 'REFERENCE.md'), 'utf8');
  const section = ref.slice(ref.indexOf('### The dead-site list'), ref.indexOf('### Pulling upstream changes'));
  assert.doesNotMatch(section, /After several runs/);
  assert.match(section, /retired/);
  assert.match(section, /catalog survey/);
  assert.doesNotMatch(ref, /about 500 sites/);
});

