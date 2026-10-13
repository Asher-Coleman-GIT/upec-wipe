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
  const check = src.indexOf('checkRetired(process.argv)');
  assert.ok(check > 0, 'watcher.js must call checkRetired');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'lib', 'retired-flags.js'), 'utf8'), /require\(/, 'the retired-flag check requires nothing');
  assert.ok(check < src.indexOf('parseWatcherFlags(process.argv)'), 'before flags are parsed');
  assert.ok(check < src.indexOf('require(`./lib/modes/'), 'before any mode loads');
});

test('the dashboard is gone', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'dashboard')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'lib', 'dashboard-creds.js')), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(pkg), /dashboard/);
  for (const f of ['bin/upec-wipe.js', 'lib/child-env.js', 'install.sh', 'docker-compose.yml', 'Dockerfile']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const line of src.split('\n')) {
      if (/dashboard/i.test(line)) assert.match(line, /removed/i, `${f}: ${line}`);
    }
  }
});

const REMOVED_MODULES = [
  'lib/modes/know.js', 'lib/modes/know-status.js', 'lib/modes/complaints.js', 'lib/modes/breach.js',
  'lib/modes/score.js', 'lib/modes/report.js', 'lib/modes/freeze.js', 'lib/modes/confirm-emails.js',
  'lib/exposure.js', 'lib/complaint.js', 'lib/right-to-know.js', 'lib/right-to-know-runner.js',
  'lib/hibp.js', 'lib/freeze.js', 'lib/report.js', 'lib/snapshot.js', 'lib/imap-confirm.js',
];

test('the retired modules are gone and nothing requires them', () => {
  for (const f of REMOVED_MODULES) assert.equal(fs.existsSync(path.join(ROOT, f)), false, `${f} still exists`);
  const files = ['watcher.js', 'setup.js', 'brokers.js'];
  for (const d of ['lib', 'lib/modes', 'bin', 'scripts']) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) if (f.endsWith('.js')) files.push(path.join(d, f));
  }
  const names = REMOVED_MODULES.map(f => path.basename(f, '.js'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const n of names) {
      assert.doesNotMatch(src, new RegExp(`require\\([^)]*[/']${n}['"]\\)`), `${f} requires ${n}`);
    }
  }
});

test('dispatch and the CLI map know only the kept modes', () => {
  const { MODE_NAMES } = require('../lib/mode-dispatch');
  for (const m of ['know', 'know-status', 'complaints', 'breach', 'score', 'report', 'freeze', 'confirm-emails', 'update-brokers']) {
    assert.equal(MODE_NAMES.includes(m), false, m);
  }
  const { buildHelp } = require('../lib/cli-map');
  const help = buildHelp();
  for (const c of ['know', 'complaints', 'breach', 'score', 'report', 'freeze', 'dashboard', 'update-brokers']) {
    assert.doesNotMatch(help, new RegExp(`^\\s+${c}\\s`, 'm'), c);
  }
  assert.doesNotMatch(help, /^\s+serp\s/m);
  assert.match(help, /^\s+serp-watch\s/m);
  assert.doesNotMatch(help, /--right-to-know/);
});

test('serp-watch still runs and the serp scan block is gone', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'modes', 'run.js'), 'utf8');
  assert.match(src, /require\('\.\.\/serp-watch'\)/);
  assert.doesNotMatch(src, /SERP_SCAN|runSerpScan|SNAPSHOT/);
  assert.equal(fs.existsSync(path.join(ROOT, 'lib', 'serp-scan.js')), true);
});

test('--dry-run is still an alias of --preview', () => {
  const { parseWatcherFlags } = require('../lib/cli-flags');
  const f = parseWatcherFlags(['node', 'watcher.js', '--dry-run']);
  assert.equal(f.DRY_RUN, true);
  for (const k of ['KNOW_MODE', 'SCORE_MODE', 'REPORT', 'BREACH_CHECK', 'FREEZE_MODE', 'SNAPSHOT', 'CONFIRM_EMAILS', 'SERP_SCAN', 'UPDATE_BROKERS', 'COMPLAINTS_MODE', 'KNOW_STATUS']) {
    assert.equal(k in f, false, k);
  }
});

const os = require('node:os');

test('doctor reports a hibp block and leftover files, and passes without them', async () => {
  const { checkRetiredSettings } = require('../lib/doctor');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-doctor-'));
  try {
    assert.equal((await checkRetiredSettings({}, root)).ok, true);
    const hibp = await checkRetiredSettings({ hibp: { apiKey: '' } }, root);
    assert.equal(hibp.ok, false);
    assert.match(hibp.hint, /remove the "hibp" block from config\.json \(the breach check was removed\)/);
    fs.mkdirSync(path.join(root, 'logs', 'snapshots'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'exposure-history.json'), '{}');
    const left = await checkRetiredSettings({}, root);
    assert.equal(left.ok, false);
    assert.match(left.hint, /logs\/snapshots holds your details from a removed command; delete it when you no longer need it/);
    assert.match(left.hint, /data\/exposure-history\.json holds your details from a removed command/);
    assert.ok(fs.existsSync(path.join(root, 'logs', 'snapshots')), 'doctor never deletes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the example config has no hibp block', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
  assert.equal('hibp' in ex, false);
});

const KEPT_DOCS = ['README.md', 'STATUS.md', 'FORK.md', 'SECURITY.md', 'docs/REFERENCE.md', 'docs/UPEC-MANUAL.md', 'docs/PRIVACY.md', 'docs/THREAT-MODEL.md', 'docs/SYNOLOGY.md'];
const RETIRED_WORDS = /`(know|know-status|complaints|breach|score|report|freeze|dashboard|update-brokers|serp)`|--(know|complaints|breach-check|score|report|freeze|snapshot|confirm-emails|serp-scan|update-brokers|right-to-know)\b|Have I Been Pwned|haveibeenpwned/;

test('the kept docs mention retired commands only as retired', () => {
  for (const f of KEPT_DOCS) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const retiredTable = text.indexOf('## Retired commands');
    text.split('\n').forEach((line, i) => {
      if (!RETIRED_WORDS.test(line)) return;
      const inTable = retiredTable !== -1 && text.indexOf(line) > retiredTable && line.startsWith('|');
      assert.ok(inTable || /removed|retired|moved/i.test(line), `${f}:${i + 1}: ${line}`);
    });
  }
});

test('REFERENCE has the retired commands table and the manual the freeze section', () => {
  const ref = fs.readFileSync(path.join(ROOT, 'docs', 'REFERENCE.md'), 'utf8');
  assert.match(ref, /## Retired commands/);
  for (const c of ['know', 'complaints', 'breach', 'score', 'report', 'freeze', 'snapshot', 'confirm-emails', 'serp', 'dashboard', 'update-brokers']) {
    assert.match(ref, new RegExp(`^\\| \`${c}\` \\|`, 'm'), c);
  }
  const manual = fs.readFileSync(path.join(ROOT, 'docs', 'UPEC-MANUAL.md'), 'utf8');
  assert.match(manual, /## Credit and identity freezes/);
  for (const n of ['Equifax', 'Experian', 'TransUnion', 'ChexSystems', 'NCTUE', 'Innovis', 'OptOutPrescreen']) assert.match(manual, new RegExp(n));
});

test('doctor also reports old complaint letters and exported emails', async () => {
  const { checkRetiredSettings } = require('../lib/doctor');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-doctor-'));
  try {
    fs.mkdirSync(path.join(root, 'logs', 'complaints'), { recursive: true });
    fs.mkdirSync(path.join(root, 'inbox'), { recursive: true });
    const r = await checkRetiredSettings({}, root);
    assert.match(r.hint, /logs\/complaints holds your details from a removed command/);
    assert.match(r.hint, /inbox holds your details from a removed command/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the fixture never copies the member\'s own data files', () => {
  const { copyFilter } = require('./helpers/fixture-repo');
  const D = path.join(ROOT, 'data');
  for (const f of ['serp-history.json', '.serp-key', 'exposure-history.json', 'exposure-history.json.bak']) {
    assert.equal(copyFilter(path.join(D, f)), false, f);
  }
  assert.equal(copyFilter(path.join(D, 'catalog', 'example.com.json')), true);
  assert.equal(copyFilter(path.join(ROOT, 'lib', 'config.js')), true);
});

test('code comments do not describe removed features as live', () => {
  const files = ['watcher.js', 'setup.js', 'docker-compose.yml', 'Dockerfile'];
  for (const d of ['lib', 'lib/modes', 'bin', 'scripts']) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) if (/\.(js|sh)$/.test(f)) files.push(path.join(d, f));
  }
  const STALE = /right-to-know|--know\b|\bknow step|dashboard|complaints, reports|update-brokers/i;
  for (const f of files) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (!STALE.test(line) || /simplelogin\.io\/dashboard/.test(line)) return;
      if (/^\s*(const REMOVED|\{ flag:|\.\.\.\[)/.test(line) || /removed|retired|moved|\bwas\b|\bold\b|leftover/i.test(line)) return;
      if (/^\s*(know|'know-status'|complaints|dashboard|breach|score|report|freeze|serp):/.test(line)) return; // REMOVED_COMMANDS keys
      assert.fail(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
});

test('docs never name a removed upec-wipe command as live, README layout included', () => {
  const RE = /upec-wipe (know|know-status|complaints|breach|score|report|freeze|dashboard|update-brokers|serp)(?![\w-])/;
  for (const f of KEPT_DOCS) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (RE.test(line)) assert.match(line, /removed|retired|moved|\bwas\b/i, `${f}:${i + 1}: ${line}`);
    });
  }
  const layout = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').split('\n').find(l => l.includes('lib/modes/'));
  assert.doesNotMatch(layout, /\bknow\b|\bbreach\b/, layout);
});

test('watcher refuses any --flag=value form (kept flags take their value as the next argument)', () => {
  for (const arg of ['--clear-all=yes', '--preview=1', '--only=Spokeo']) {
    const r = runIn(dir, 'watcher.js', [arg]);
    assert.equal(r.status, 1, arg);
    assert.match(r.stderr, new RegExp(`^${arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is not a valid flag: write the value as the next argument\\.$`, 'm'));
    assert.doesNotMatch(r.stderr + r.stdout, /BROWSER_MODULE_LOADED/);
  }
});

test('doctor and clear-all know the old dashboard folder', async () => {
  const { checkRetiredSettings } = require('../lib/doctor');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-doctor-'));
  try {
    fs.mkdirSync(path.join(root, 'dashboard'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dashboard', '.auth.json'), '{}');
    assert.match((await checkRetiredSettings({}, root)).hint, /dashboard\/\.auth\.json holds your details from a removed command/);
    const { planClear } = require('../lib/modes/clear');
    assert.ok(planClear({ all: true, root, home: root, env: {} }).remove.includes(path.join(root, 'dashboard')));
    assert.equal(planClear({ all: false, root, home: root, env: {} }).remove.includes(path.join(root, 'dashboard')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
