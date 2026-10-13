# Retire the side commands and the dashboard - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `know`, `know-status`, `complaints`, `breach`, `score`, `report`, `freeze`, `snapshot`, `confirm-emails`, `serp`, `dashboard` and `reply --right-to-know`; move `update-brokers` to a script; every removed flag or subcommand refuses with one line and exit 1.

**Architecture:** Refusal first (a `REMOVED` table in `watcher.js` and a `REMOVED_COMMANDS` map in `bin/upec-wipe.js`), so nothing can fall through to a real run while code is deleted. Spawn tests run in a temp copy of the repo with no config, through a new shared helper. Then the modes, libraries and dashboard come out, `update-brokers` moves, doctor learns the leftovers, and the docs follow.

**Tech Stack:** Node.js (CommonJS), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-13-retire-commands-design.md`

## Global Constraints

- Branch: `upec/retire-commands` (exists; both specs are committed there).
- **Every test that spawns `watcher.js` or `bin/upec-wipe.js` spawns the copy made by `test/helpers/fixture-repo.js`, never `ROOT`.** Before a refusal exists, or if it breaks later, the child falls through to a real opt-out run with the member's real `config.json`.
- Never run `setup.js`, `upec-wipe run`, `--email`, `preview`, `node watcher.js` or `bin/upec-wipe.js` in the real tree except `--help`. Never read or print `config.json`, `config.json.enc`, `state.json`, `logs/` or `secrets/`.
- Refusal format: `<flag> was removed: <reason>. See docs/REFERENCE.md.` to stderr, exit 1, checked before `parseWatcherFlags`, any config read and any browser module load. A match is `arg === flag || arg.startsWith(flag + '=')`.
- Plain hyphens only in tracked files; no emoji in output; no real personal data anywhere (tests use Jane Doe, Austin TX).
- Dated documents under `docs/superpowers/` and `docs/plans/` are not edited, except this plan and the two specs.
- `npm test` (about 80 s). The dashboard suite and the flaky `test/cli-dashboard-boot.test.js` are deleted in Task 2.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A removed flag passed through `bin` (`upec-wipe run --know`) must refuse, not only `node watcher.js --know`: Task 1 tests it.
2. `--dry-run` must keep working as an alias of `--preview` (old Docker commands): Task 3 keeps a flag test for it.
3. A config that still has a `hibp` block or an old `generic` block must not break `doctor` or a run; doctor reports them: Task 5.
4. `reply <broker> <outcome>` for an email request must log exactly as before, under the lock: Task 3 keeps the existing reply tests passing and adds the refusal for `--right-to-know`.
5. `serp-watch` must still run its scan after the `serp` block goes, because `runSerpWatch` uses `lib/serp-scan.js` internally: Task 3 keeps `lib/serp-scan.js` and its tests, and a test pins that `run.js` still requires `../serp-watch`.

---

### Task 1: Refuse removed flags and subcommands (fixture-based tests)

**Files:**
- Create: `test/helpers/fixture-repo.js`
- Create: `test/removed-commands.test.js`
- Modify: `watcher.js` (replace the `--generic` block, lines 27-33)
- Modify: `bin/upec-wipe.js` (`main()`, before `resolveCommand`)
- Modify: `test/generic-retired.test.js` (its `runNode` spawns the fixture)

**Interfaces:**
- Produces: `makeFixtureRepo() -> string` (absolute path of a temp copy with no config/state; caller removes it) and `runIn(dir, relScript, args) -> spawnSync result` from `test/helpers/fixture-repo.js`.
- Produces: `REMOVED` (array of `{ flag, message }`) in `watcher.js`, `REMOVED_COMMANDS` (object name -> message) in `bin/upec-wipe.js`.

- [ ] **Step 1: Write the helper**

`test/helpers/fixture-repo.js`:

```js
'use strict';
// A temp copy of the repo with no config.json or state.json, for tests that
// spawn watcher.js or bin/upec-wipe.js. Code is copied (not symlinked): Node
// resolves a symlinked lib/ to the real tree, whose config.json is real.
// node_modules and data/ are symlinked: nothing there locates the config.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const COPY = ['watcher.js', 'brokers.js', 'setup.js', 'package.json', 'config.example.json', 'lib', 'bin', 'scripts'];

function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-fixture-'));
  for (const f of COPY) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, f), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.symlinkSync(path.join(ROOT, 'data'), path.join(dir, 'data'), 'dir');
  for (const f of ['config.json', 'config.json.enc', 'state.json']) {
    if (fs.existsSync(path.join(dir, f))) throw new Error(`fixture must not hold ${f}`);
  }
  return dir;
}

// Spawn relScript inside dir with a preload that reports any playwright load.
function runIn(dir, relScript, args) {
  const preload = path.join(dir, '.trap.js');
  if (!fs.existsSync(preload)) {
    fs.writeFileSync(preload, [
      "'use strict';",
      "const Module = require('module');",
      'const orig = Module._load;',
      'Module._load = function (req, ...rest) {',
      "  if (/^playwright(-core)?(\\/|$)/.test(String(req))) process.stderr.write('BROWSER_MODULE_LOADED\\n');",
      '  return orig.call(this, req, ...rest);',
      '};',
    ].join('\n'));
  }
  const env = { ...process.env, NODE_ENV: 'test', HOME: dir, USERPROFILE: dir };
  delete env.UPEC_WIPE_STATE_PATH;
  delete env.UPEC_WIPE_PASSPHRASE;
  delete env.UPEC_WIPE_PASSPHRASE_FILE;
  return spawnSync(process.execPath, ['-r', preload, path.join(dir, relScript), ...args], {
    cwd: dir, encoding: 'utf8', timeout: 30000, env,
  });
}

module.exports = { makeFixtureRepo, runIn, ROOT };
```

- [ ] **Step 2: Write the failing tests**

`test/removed-commands.test.js`:

```js
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
```

(The modules `watcher.js` requires above the check, `lib/cli-flags`, `lib/mode-dispatch`, `lib/browser` and `lib/privilege`, read no config and load no Playwright.)

In `test/generic-retired.test.js`, replace `runNode` so it spawns the fixture:

```js
const { makeFixtureRepo, runIn } = require('./helpers/fixture-repo');
const FIXTURE = makeFixtureRepo();
test.after(() => fs.rmSync(FIXTURE, { recursive: true, force: true }));
function runNode(script, args) {
  return runIn(FIXTURE, path.relative(ROOT, script), args);
}
```

(delete the old `runNode` body and its `spawnSync`/`os` imports if they become unused).

- [ ] **Step 3: Run them to verify they fail (fixture only)**

Run: `node --require ./test/helpers/egress-off.js --test test/removed-commands.test.js`
Expected: the refusal tests FAIL (the fixture has no config, so a fall-through ends in `config.json not found`, never a real run); `--generic` cases and `generic-retired.test.js` PASS.

- [ ] **Step 4: Implement**

`watcher.js`: replace the `--generic` block with:

```js
// Retired flags refuse before any config is read, as --pollute does. A flag
// that fell through would start a real opt-out run.
const SEE_REF = 'See docs/REFERENCE.md.';
const CCPA = `it cited California law (CCPA) for every non-EU member. ${SEE_REF}`;
const SCORE = `the exposure score depended on the breach check. ${SEE_REF}`;
const FREEZE = 'the freeze checklist is in docs/UPEC-MANUAL.md.';
const REMOVED = [
  { flag: '--generic', message: 'The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.' },
  ...['--know', '--know-status', '--complaints'].map(flag => ({ flag, message: `${flag} was removed: ${CCPA}` })),
  { flag: '--breach-check', message: `--breach-check was removed: it sent your real email to Have I Been Pwned. ${SEE_REF}` },
  ...['--score', '--report'].map(flag => ({ flag, message: `${flag} was removed: ${SCORE}` })),
  ...['--freeze', '--freeze-done', '--freeze-clear'].map(flag => ({ flag, message: `${flag} was removed: ${FREEZE}` })),
  { flag: '--snapshot', message: `--snapshot was removed: it saved screenshots of forms with your details. ${SEE_REF}` },
  { flag: '--confirm-emails', message: `--confirm-emails was removed: click confirmation links yourself. ${SEE_REF}` },
  { flag: '--serp-scan', message: '--serp-scan was removed: use upec-wipe serp-watch.' },
  { flag: '--update-brokers', message: '--update-brokers moved: run node scripts/update-catalog-sources.js.' },
  { flag: '--right-to-know', message: `--right-to-know was removed with the know command. ${SEE_REF}` },
];
for (const { flag, message } of REMOVED) {
  if (process.argv.some(a => a === flag || a.startsWith(`${flag}=`))) {
    console.error(message);
    process.exit(1);
  }
}
```

Order matters: `--know-status` must not be matched by `--know` (it is not: the match is exact or `--know=`).

`bin/upec-wipe.js`, in `main()` right after `const args = process.argv.slice(2);`:

```js
  // Retired subcommands refuse with the same reasons watcher.js gives.
  const REMOVED_COMMANDS = {
    know: 'it cited California law (CCPA) for every non-EU member. See docs/REFERENCE.md.',
    'know-status': 'it cited California law (CCPA) for every non-EU member. See docs/REFERENCE.md.',
    complaints: 'it cited California law (CCPA) for every non-EU member. See docs/REFERENCE.md.',
    breach: 'it sent your real email to Have I Been Pwned. See docs/REFERENCE.md.',
    score: 'the exposure score depended on the breach check. See docs/REFERENCE.md.',
    report: 'the exposure score depended on the breach check. See docs/REFERENCE.md.',
    freeze: 'the freeze checklist is in docs/UPEC-MANUAL.md.',
    serp: 'use upec-wipe serp-watch.',
    dashboard: 'use the CLI; see docs/REFERENCE.md.',
  };
  if (args[0] === 'update-brokers') {
    process.stderr.write('update-brokers moved: run node scripts/update-catalog-sources.js.\n');
    process.exit(1);
  }
  if (Object.prototype.hasOwnProperty.call(REMOVED_COMMANDS, args[0])) {
    process.stderr.write(`${args[0]} was removed: ${REMOVED_COMMANDS[args[0]]}\n`);
    process.exit(1);
  }
```

(`run --know` reaches `watcher.js`, which refuses it.)

- [ ] **Step 5: Run to verify they pass, then the suite**

Run: `node --require ./test/helpers/egress-off.js --test test/removed-commands.test.js test/generic-retired.test.js test/pollute-disabled.test.js`
Expected: all pass.

Run: `npm test`
Expected: all pass. Existing tests that spawn a removed mode (for example `test/freeze-cli.test.js`, `test/breach-mode.test.js`) now fail on the refusal: delete those whole files in this task (they test removed commands) and note each in the commit message.

- [ ] **Step 6: Commit**

```bash
git add -A test/ watcher.js bin/upec-wipe.js
git commit -m "feat: refuse the retired flags and subcommands

Spawn tests run in a config-free copy of the repo (test/helpers/fixture-repo.js).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remove the dashboard

**Files:**
- Delete: `dashboard/` (whole folder, including its `node_modules`, tests and `package.json`), `lib/dashboard-creds.js`, `test/dashboard-creds.test.js`, `test/cli-dashboard-boot.test.js`, `test/cli-dispatch-paths.test.js` (its subject is the dashboard path; keep any non-dashboard case by moving it to `test/cli-map.test.js`)
- Modify: `lib/cli-map.js` (delete the `dashboard` entry), `bin/upec-wipe.js` (the `dashboard` branch in `spawnNode`, the `generateDashboardCreds` require, the header comment), `lib/child-env.js` (`cliChildEnv`'s dashboard special case), `package.json` (`files` entry `dashboard/`, the `test` script's `dashboard/validate.test.js dashboard/config-status.test.js`), `install.sh` (step 5 and the closing "Open the local web dashboard" lines), `docker-compose.yml` / `Dockerfile` (anything only for the dashboard: ports, `cd dashboard`), `test/install-script.test.js`, `test/docker-build-contract.test.js`, `test/child-env.test.js`, `test/cli-bin-smoke.test.js`, `test/docs-commands.test.js` (`install.sh installs the dashboard dependencies` test), `test/umask-file-modes.test.js`, `CLAUDE.md` line 5 (drop "dashboard tests are separate...") and line 31 (drop the dashboard-boot flake note)
- Test: `test/removed-commands.test.js` (append)

**Interfaces:**
- Produces: `cliChildEnv(command, base)` that always strips (no dashboard exception) or is removed if `childEnv` serves every caller.

- [ ] **Step 1: Write the failing test**

Append to `test/removed-commands.test.js`:

```js
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
```

(The `REMOVED_COMMANDS` entry in `bin/upec-wipe.js` mentions `dashboard` on a line with "removed" through the message template; if the key line `dashboard: 'use the CLI; see docs/REFERENCE.md.',` trips the test, add a trailing comment `// removed`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/removed-commands.test.js`
Expected: FAIL on `dashboard` still existing.

- [ ] **Step 3: Remove**

`git rm -r dashboard lib/dashboard-creds.js test/dashboard-creds.test.js test/cli-dashboard-boot.test.js`, then make the modifications listed under Files. In `bin/upec-wipe.js`, `spawnNode` becomes:

```js
function spawnNode(resolved) {
  const { cwd, args } = resolveSpawnTarget(resolved, ROOT);
  const env = cliChildEnv(resolved.command, process.env);
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (signal) { process.exit(1); }
    process.exit(code === null ? 1 : code);
  });
  child.on('error', err => {
    process.stderr.write(`upec-wipe: failed to start ${resolved.file}: ${err.message}\n`);
    process.exit(1);
  });
}
```

`lib/child-env.js`: `cliChildEnv` becomes `function cliChildEnv(_command, base) { return childEnv(base); }` (keep the export so callers need not change), and its comment says every child is stripped.

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: all pass. (`node --test dashboard/*.test.js` no longer applies.)

- [ ] **Step 5: Commit**

```bash
git add -A bin/ lib/ test/ package.json install.sh docker-compose.yml Dockerfile CLAUDE.md
git commit -m "feat: remove the dashboard

It could not run the email step, log replies or check the catalog, and it
was the largest attack surface (a local web server with a login).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Remove the retired modes and libraries

**Files:**
- Delete modes: `lib/modes/know.js`, `know-status.js`, `complaints.js`, `breach.js`, `score.js`, `report.js`, `freeze.js`, `confirm-emails.js`
- Delete libraries: `lib/exposure.js`, `lib/complaint.js`, `lib/right-to-know.js`, `lib/right-to-know-runner.js`, `lib/hibp.js`, `lib/freeze.js`, `lib/report.js`, `lib/snapshot.js`, `lib/imap-confirm.js`
- Delete tests (each only covers removed code): `test/breach-mode.test.js`, `complaint-build`, `complaint-find-overdue`, `complaint-regime-multiperson`, `complaint-write`, `exposure-format-score`, `exposure`, `freeze`, `freeze-cli`, `hibp-confirm`, `hibp`, `imap-confirm`, `modes-know-run`, `report-double-categorize`, `report-exposure-trend`, `report-html`, `report-model`, `report-pdf`, `right-to-know-step`, `right-to-know`, `right-to-know-config`, `snapshot`, `watcher-know-step`, `reply-right-to-know` (all `test/<name>.test.js`; skip any already deleted in Task 1)
- Modify: `lib/mode-dispatch.js`, `lib/cli-flags.js`, `lib/cli-map.js`, `lib/modes/run.js` (lines 41, 194-232, 308), `lib/broker-runner.js` (lines 25, 32, 278-321), `lib/modes/reply.js`, `lib/config.js` (`recordKnowRequest`, `getPendingKnowRequests` and exports), `lib/feeds.js` only if it requires a removed module
- Modify tests: `test/watcher-mode-dispatch.test.js`, `test/cli-map.test.js`, `test/cli-flags.test.js`, `test/node-egress.test.js` (its `runBreachCheck` case), `test/umask-file-modes.test.js`, and any other shared file the suite shows failing

**Interfaces:**
- Consumes: Task 1's refusals (removed flags never reach dispatch); Task 2 removed `dashboard/server.js`, the last other user of `lib/freeze.js` and `lib/exposure.js`.
- Produces: `MODE_NAMES` without the removed modes; `COMMANDS` in `lib/cli-map.js` without them; `replyArgs` unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `test/removed-commands.test.js`:

```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --require ./test/helpers/egress-off.js --test test/removed-commands.test.js`
Expected: the four new tests FAIL.

- [ ] **Step 3: Remove the code**

1. `git rm` the modes, libraries and tests listed above.
2. `lib/mode-dispatch.js`: `MODES` keeps `encryptConfig`, `decryptConfig`, `list`, `pending`, `doctor`, `serpWatch`; `EARLY_MODES` keeps `encrypt-config`, `list`, `reply`, `pending`, `allowlist`; `LATE_MODES` keeps `doctor`; the `resolveMode` call in `pickMode` passes only `list`, `doctor`, `pending`, `serpWatch`, `encryptConfig`, `decryptConfig`; the header comment's flag list matches.
3. `lib/cli-flags.js`: remove `FREEZE_LIST`, `FREEZE_DONE_KEY`, `FREEZE_CLEAR_KEY`, `confirmEmailsIdx`, `CONFIRM_EMAILS`, `next`, and the returned keys `SERP_SCAN`, `SCORE_MODE`, `UPDATE_BROKERS`, `BREACH_CHECK`, `SNAPSHOT`, `REPORT`, `KNOW_MODE`, `KNOW_STATUS`, `COMPLAINTS_MODE`, `FREEZE_LIST`, `FREEZE_DONE_KEY`, `FREEZE_CLEAR_KEY`, `FREEZE_MODE`, `CONFIRM_EMAILS`, `confirmEmailsDir`. In the value-flag list used by `replyArgs`, drop removed flags (`--freeze-done`, `--freeze-clear`) and fix the comment that mentions `--confirm-emails` and `--right-to-know`.
4. `lib/cli-map.js`: delete the `score`, `report`, `serp`, `breach`, `freeze`, `complaints`, `know`, `update-brokers`, `dashboard` entries; `reply`'s desc drops ` [--right-to-know]`; the header comment drops "and dashboard/server.js MODE_ARGS". If `resolveSpawnTarget` handles `cwd: 'dashboard'`, remove that branch.
5. `lib/modes/run.js`: drop `SNAPSHOT` and `SERP_SCAN` from the destructure (line 41); delete the `// ── SERP scan mode` block (lines 194-232); remove `snapshot: SNAPSHOT, ` from `createBrokerRunner` (line 308).
6. `lib/broker-runner.js`: delete the `captureSubmitSnapshot` require (line 25), `snapshot: false, ` from `DEFAULT_OPTIONS` (line 32), the Step 5b block (lines 278-282) and `snapshotSuffix` (line 309) and its three uses (lines 311, 317, 321 become `confirm.snippet || 'check your email to confirm'`, `snippet || 'form submission may have failed'`, `snippet`).
7. `lib/modes/reply.js`: remove the `forKnow` / `prefix` lines and the `--right-to-know` comment; `names` is always the catalog-plus-brokers list; `const base = found.name;`; the usage line drops ` [--right-to-know]`; the final message is `${found.name}: reply logged as ${outcome}.`.
8. `lib/config.js`: delete `recordKnowRequest` and `getPendingKnowRequests` and their exports, after `grep -rn "recordKnowRequest\|getPendingKnowRequests" lib bin scripts` shows no other user.
9. Run `grep -rn "require(.*\(exposure\|complaint\|right-to-know\|hibp\|lib/freeze\|/freeze'\|/report'\|snapshot\|imap-confirm\)" lib bin scripts watcher.js setup.js` and fix any remaining user.
10. Shared tests: `test/watcher-mode-dispatch.test.js`, `test/cli-map.test.js`, `test/cli-flags.test.js` lose the cases for removed modes and keep the rest; `test/node-egress.test.js` loses its `runBreachCheck` case; run `npm test` and remove only removed-feature cases from any other failing file. Never weaken an assertion about a kept command.

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A lib/ bin/ test/
git commit -m "feat: remove know, complaints, breach, score, report, freeze, snapshot, confirm-emails and serp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Move update-brokers to scripts/update-catalog-sources.js

**Files:**
- Create: `scripts/update-catalog-sources.js`
- Delete: `lib/modes/update-brokers.js`
- Test: `test/update-catalog-sources.test.js` (create)

**Interfaces:**
- Produces: `scripts/update-catalog-sources.js` exporting `main({ runUpdateBrokers, loadConfig, setEgressConfig, log, warn }) -> Promise<number>` (all injectable) and running `main()` when it is the entry point.

- [ ] **Step 1: Write the failing test**

`test/update-catalog-sources.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('update-catalog-sources runs the feeds refresh behind the egress config', async () => {
  const { main } = require('../scripts/update-catalog-sources');
  const calls = [];
  const code = await main({
    loadConfig: () => ({ network: { required: true } }),
    configExists: () => true,
    setEgressConfig: (c) => calls.push(['egress', c]),
    runUpdateBrokers: async (o) => { calls.push(['update', Array.isArray(o.brokers), typeof o.logFn]); },
    log: () => {}, warn: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(calls[0], ['egress', { network: { required: true } }]);
  assert.deepEqual(calls[1], ['update', true, 'function']);
});

test('an unreadable config falls back to the Mullvad-required defaults, with a warning', async () => {
  const { main } = require('../scripts/update-catalog-sources');
  const warned = [];
  let egress;
  const code = await main({
    loadConfig: () => { throw Object.assign(new Error('x'), { code: 'EBADCFG' }); },
    configExists: () => true,
    setEgressConfig: (c) => { egress = c; },
    runUpdateBrokers: async () => {},
    log: () => {}, warn: (m) => warned.push(m),
  });
  assert.equal(code, 0);
  assert.deepEqual(egress, {});
  assert.match(warned[0], /using network defaults \(Mullvad check required\)/);
});

test('a failed refresh exits 1', async () => {
  const { main } = require('../scripts/update-catalog-sources');
  const code = await main({
    loadConfig: () => ({}), configExists: () => false, setEgressConfig: () => {},
    runUpdateBrokers: async () => { throw new Error('boom'); }, log: () => {}, warn: () => {},
  });
  assert.equal(code, 1);
});

test('the update-brokers mode is gone', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'lib', 'modes', 'update-brokers.js')), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/update-catalog-sources.test.js`
Expected: FAIL, `Cannot find module '../scripts/update-catalog-sources'`.

- [ ] **Step 3: Implement**

`scripts/update-catalog-sources.js`:

```js
#!/usr/bin/env node
// scripts/update-catalog-sources.js - refresh data/feeds-brokers.json from the
// California and Vermont data-broker registries (was `upec-wipe update-brokers`).
//
//   node scripts/update-catalog-sources.js
//
// HTTP only, no browser, through the Mullvad check. scripts/catalog-candidates.js
// reads the file with the bundled Markup and BADBOOL lists.
'use strict';
process.umask(0o077);
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

async function main(deps = {}) {
  const config = require(path.join(ROOT, 'lib/config'));
  const {
    loadConfig = config.loadConfig,
    configExists = () => fs.existsSync(config.CONFIG_PATH) || fs.existsSync(config.CONFIG_ENC_PATH),
    setEgressConfig = require(path.join(ROOT, 'lib/egress')).setEgressConfig,
    runUpdateBrokers = require(path.join(ROOT, 'lib/feeds')).runUpdateBrokers,
    log = (m) => console.log(m),
    warn = (m) => console.warn(m),
  } = deps;
  // The egress gate needs network.required / network.proxy. With no readable
  // config it falls back to {} and requires Mullvad (fail closed).
  let cfg = {};
  try {
    if (configExists()) cfg = loadConfig();
  } catch (err) {
    warn(`Warning: config could not be read (${config.configErrorReason(err)}); using network defaults (Mullvad check required).`);
    cfg = {};
  }
  setEgressConfig(cfg);
  try {
    await runUpdateBrokers({ brokers: require(path.join(ROOT, 'brokers')), logFn: log, config: cfg });
    return 0;
  } catch (err) {
    console.error('update-catalog-sources error:', err.message);
    return 1;
  }
}

if (require.main === module) {
  require(path.join(ROOT, 'lib/privilege')).exitIfRoot();
  main().then((code) => process.exit(code));
}

module.exports = { main };
```

`git rm lib/modes/update-brokers.js`; remove `update-brokers` from `LATE_MODES`, `MODES` and `resolveMode`'s call in `lib/mode-dispatch.js` and `UPDATE_BROKERS` from `lib/cli-flags.js` if Task 3 left them.

- [ ] **Step 4: Verify**

Run: `node --test test/update-catalog-sources.test.js && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A scripts/update-catalog-sources.js lib/ test/update-catalog-sources.test.js
git commit -m "refactor: update-brokers becomes scripts/update-catalog-sources.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Doctor reports leftovers; drop the hibp example block

**Files:**
- Modify: `lib/doctor.js` (`checkRetiredSettings(cfg, rootDir)`; its call in `runDoctor`)
- Modify: `config.example.json` (delete the `hibp` block, lines 29-32)
- Test: `test/removed-commands.test.js` (append); `test/generic-retired.test.js` (its `checkRetiredSettings` calls gain a temp `rootDir`)

**Interfaces:**
- Consumes: `checkRetiredSettings(cfg)` from the generic-pass work.
- Produces: `checkRetiredSettings(cfg, rootDir) -> Promise<{ ok, hint }>`; with several problems the hint joins them with `; `.

- [ ] **Step 1: Write the failing tests**

Append to `test/removed-commands.test.js`:

```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --require ./test/helpers/egress-off.js --test test/removed-commands.test.js`
Expected: the two new tests FAIL.

- [ ] **Step 3: Implement**

`lib/doctor.js`:

```js
const LEFTOVERS = ['logs/snapshots', 'logs/reports', 'data/exposure-history.json'];

/**
 * Check: no setting or file left from a retired feature. A run refuses
 * generic.enabled: true; the rest are reported so the member can clean up.
 * Doctor never deletes anything.
 */
async function checkRetiredSettings(cfg, rootDir = path.join(__dirname, '..')) {
  const { genericRetiredMessage } = require('./submission-plan');
  const problems = [];
  const generic = genericRetiredMessage(cfg);
  if (generic) problems.push(generic);
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'hibp')) {
    problems.push('remove the "hibp" block from config.json (the breach check was removed)');
  }
  for (const rel of LEFTOVERS) {
    if (fs.existsSync(path.join(rootDir, rel))) {
      problems.push(`${rel} holds your details from a removed command; delete it when you no longer need it`);
    }
  }
  return problems.length ? { ok: false, hint: problems.join('; ') } : { ok: true, hint: 'no retired settings' };
}
```

In `runDoctor`: `{ name: 'retired',    run: () => checkRetiredSettings(cfg, rootDir) },`. Delete the `hibp` block from `config.example.json` and confirm it parses.

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: all pass (the generic-retired doctor test still gets the generic message alone, since a temp-free call uses the repo root; if the real repo has leftover paths, pass a temp `rootDir` in that test).

- [ ] **Step 5: Commit**

```bash
git add lib/doctor.js config.example.json test/removed-commands.test.js test/generic-retired.test.js
git commit -m "feat: doctor reports leftovers from removed commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs

**Files:**
- Modify: `README.md`, `docs/REFERENCE.md`, `docs/UPEC-MANUAL.md`, `docs/PRIVACY.md`, `docs/THREAT-MODEL.md`, `SECURITY.md`, `docs/SYNOLOGY.md`, `FORK.md`, `STATUS.md`, `docs/CROSS_MODEL_REVIEW.md`, `CLAUDE.md` (line 16: "Never runs as root; the dashboard listens on loopback only; there is no background scheduler." becomes "Never runs as root; there is no background scheduler.")
- Test: `test/removed-commands.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/removed-commands.test.js`:

```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --require ./test/helpers/egress-off.js --test test/removed-commands.test.js`
Expected: FAIL, naming README.md lines first.

- [ ] **Step 3: Edit the docs**

- README: remove the `report`, `complaints`, `know`, `breach`, `freeze`, `serp` (keep `serp-watch`), `update-brokers`, `dashboard` and `score` rows from the command table; the `reply` row drops nothing (it never listed `--right-to-know`); remove `dashboard/` from the layout map and the docs index row for SYNOLOGY stays; add one line under the table: `Retired commands and why: [docs/REFERENCE.md](docs/REFERENCE.md#retired-commands).`
- `docs/REFERENCE.md`: add `## Retired commands` before "Is it safe to submit my details to brokers?", with this table:

```markdown
## Retired commands

Each prints one line saying it was removed and exits without doing anything.

| Command | Why it went | Use instead |
| --- | --- | --- |
| `know` | It cited California law (CCPA) for every non-EU member, which does not apply to Utah residents, and sent your phone number. | The email requests (`run --email`) ask for deletion under Utah law. |
| `complaints` | Same California-law problem: it drafted complaints to the wrong regulator. | File with the Utah Division of Consumer Protection yourself if a broker ignores a request. |
| `breach` | It sent your real email to Have I Been Pwned and needed a paid key. | Check haveibeenpwned.com yourself. |
| `score` | Built mostly from the breach check. | `verify` and `serp-watch`. |
| `report` | A PDF of the score. | `list` and `verify`. |
| `freeze` | A checklist that sent nothing. | The manual's "Credit and identity freezes" section. |
| `snapshot` | Saved screenshots of forms with your details. | Nothing. |
| `confirm-emails` | Clicked links from exported emails unattended. | Click confirmation links yourself. |
| `serp` | `serp-watch` does the same search and lists what is new. | `serp-watch`. |
| `dashboard` | Could not run the email step or log replies, and was the largest attack surface. | The CLI. |
| `update-brokers` | Maintainer work since the generic pass was retired. | `node scripts/update-catalog-sources.js`. |
```

  Also: the environment-variable table loses the `UPEC_WIPE_HOST`/`UPEC_WIPE_PORT` and `UPEC_WIPE_USER`/`UPEC_WIPE_PASS` rows; the "Search-engine monitoring" section describes `serp-watch` only; the Maintenance section's registries text runs `node scripts/update-catalog-sources.js`; the `UPEC_WIPE_DEBUG` row stays.
- `docs/UPEC-MANUAL.md`: the command reference table loses the removed rows and `reply`'s `--right-to-know` sentence; delete the "Dashboard (optional)" section; the "What this does" paragraph's `breach` sentence goes and `serp` becomes `serp-watch`; Docker commands use `node watcher.js --preview` instead of `--dry-run`; add before "Command reference":

```markdown
## Credit and identity freezes

A freeze stops new credit or accounts being opened in your name. It is free, and you can lift it for a day when you apply for credit. The tool does not do this for you; each takes a few minutes on the bureau's site.

| Where | What it blocks |
| --- | --- |
| [Equifax](https://www.equifax.com/personal/credit-report-services/credit-freeze/) | New credit (one of the three major bureaus). Keep your PIN or login to lift it later. |
| [Experian](https://www.experian.com/freeze/center.html) | New credit (major bureau). |
| [TransUnion](https://www.transunion.com/credit-freeze) | New credit (major bureau). |
| [ChexSystems](https://www.chexsystems.com/security-freeze/place-freeze) | New checking and savings accounts. |
| [NCTUE](https://www.nctue.com/consumers) | New phone, utility and pay-TV accounts. |
| [Innovis](https://www.innovis.com/personal/securityFreeze) | New credit (the "fourth" bureau, often missed). |
| [OptOutPrescreen](https://www.optoutprescreen.com/) | Prescreened credit and insurance offers in the mail. |
```

- `docs/PRIVACY.md`: delete the Have I Been Pwned row and every HIBP mention in "Short version", "What the tool reads" (`person.email` "HIBP on `upec-wipe breach`") and "Who learns what"; the dashboard rows and sentences go; `serp` becomes `serp-watch`; the right-to-know rows go.
- `docs/THREAT-MODEL.md`: the opening paragraph loses "HIBP gets your real email when you run `upec-wipe breach`"; the dashboard layer row goes; "What this tool does not protect" loses the HIBP bullet; `serp` becomes `serp-watch`.
- `SECURITY.md`, `docs/SYNOLOGY.md`, `FORK.md`, `STATUS.md`, `docs/CROSS_MODEL_REVIEW.md` (tier-1 table: drop `dashboard/server.js`, `dashboard/validate.js`, `lib/hibp.js`, `lib/complaint.js` entries; keep history lines): remove or reword each mention so the test passes; read each line in context.
- `CLAUDE.md` line 16 as above. Also update `scripts/cross-model-gate.sh` and `scripts/cross-model-review.sh` tier-1 lists to drop the deleted files (`lib/complaint.js`, `lib/hibp.js`, `dashboard/server.js`, `dashboard/validate.js`).

- [ ] **Step 4: Verify**

Run: `node --require ./test/helpers/egress-off.js --test test/removed-commands.test.js test/docs-commands.test.js test/upec-docs.test.js test/no-em-dashes.test.js test/generic-retired.test.js && npm test`
Expected: all pass. `node bin/upec-wipe.js --help` (safe in the real tree) lists only kept commands.

- [ ] **Step 5: Commit**

```bash
git add -A README.md STATUS.md FORK.md SECURITY.md CLAUDE.md docs/ scripts/cross-model-gate.sh scripts/cross-model-review.sh test/removed-commands.test.js
git commit -m "docs: retired commands table, freeze section, drop removed commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Finish

- [ ] `npm test` green on the branch head.
- [ ] Final whole-branch review (most capable model) with this plan's Review Focus.
- [ ] Then the clear plan (`docs/superpowers/plans/2026-10-13-clear-commands.md`) runs on the same branch or a new one, before the merge.
- [ ] Count-only personal-data check, then merge and push as the member chooses.
