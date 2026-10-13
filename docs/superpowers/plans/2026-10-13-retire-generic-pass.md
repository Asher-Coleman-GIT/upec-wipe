# Retire the generic pass - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the generic pass (`generic-runner.js`, `--generic`, `generic.enabled`) so a leftover flag or setting refuses loudly, while the catalog source data and `update-brokers` keep feeding the catalog.

**Architecture:** Two refusal points (the `watcher.js` entry, before anything loads, and the run mode, right after the config loads), one doctor check, then the pass and its wiring are deleted. The dead-URL helpers that `scripts/catalog-candidates.js` still needs move to `lib/dead-urls.js` first, so nothing breaks in between. Docs follow, and PureCars is added to the catalog last.

**Tech Stack:** Node.js (CommonJS), `node:test`, Playwright (not touched).

**Spec:** `docs/superpowers/specs/2026-10-13-retire-generic-pass-design.md`

## Global Constraints

- Branch: `upec/retire-generic` (already created; the spec is committed there).
- Flag refusal text, exactly: `The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.`
- Config refusal text, exactly: `The generic pass was retired: remove the "generic" block from config.json. Its sites are in the reviewed catalog (data/catalog/).`
- Both refusals exit with code 1 and send nothing.
- Plain hyphens only in every tracked file (`test/no-em-dashes.test.js`). No emoji in output.
- No real personal data in any file, test or commit message. Tests use the dummy person (Jane Doe, Austin TX).
- Never run `setup.js`, `upec-wipe run`, `--email` or `preview` with the member's real config. Never read or print `config.json`, `state.json` or `logs/`.
- Unknown flags to `scripts/catalog-survey.js` start a full survey of every site. Only use `--only purecars.com`.
- Dated documents under `docs/superpowers/` and `docs/plans/` are not edited (except this plan and its spec).
- Full suite: `npm test` (about 80 s); dashboard: `node --test dashboard/*.test.js`. `test/cli-dashboard-boot.test.js` can time out under load; it passes alone.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `--generic` combined with other flags (`--dry-run --generic`, `preview --generic` via `bin/upec-wipe.js`) must refuse the same way: covered in Task 1 by a dry-run test and a `bin` test.
2. `generic.enabled` set to a truthy non-boolean (`"true"`, `1`) must not refuse (the old code only honored `=== true`, and a member with `"true"` never had the pass run): covered in Task 2.
3. A `generic` block with `enabled: false` (the old example config, which most members copied) must keep running and keep doctor green: covered in Task 2.
4. `--email` runs with `generic.enabled: true` must refuse before any SMTP or egress work too, since the check sits before the email step: covered in Task 2 by the source-order test.
5. `scripts/catalog-candidates.js` must keep producing the same 641 candidates after the dead-URL move: covered in Task 3 by running it and diffing.

---

### Task 1: Refuse `--generic` at the entry point

**Files:**
- Modify: `watcher.js` (after the `--pollute` block, lines 22-25)
- Test: `test/generic-retired.test.js` (create)

**Interfaces:**
- Produces: the constant message string above, which Task 5's docs tests also look for (`The generic pass was retired`).

- [ ] **Step 1: Write the failing test**

Create `test/generic-retired.test.js`:

```js
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
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FLAG_MSG = 'The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.';

function runNode(script, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-generic-'));
  const preload = path.join(dir, 'trap.js');
  fs.writeFileSync(preload, [
    "'use strict';",
    "const Module = require('module');",
    'const orig = Module._load;',
    'Module._load = function (req, ...rest) {',
    "  if (/^playwright(-core)?(\\/|$)/.test(String(req))) process.stderr.write('BROWSER_MODULE_LOADED\\n');",
    '  return orig.call(this, req, ...rest);',
    '};',
  ].join('\n'));
  try {
    return spawnSync(process.execPath, ['-r', preload, script, ...args], {
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, NODE_ENV: 'test' },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-retired.test.js`
Expected: the three tests FAIL (no retired message; the first two may hang until the 30 s timeout or fail on a missing config, which is fine).

- [ ] **Step 3: Implement**

In `watcher.js`, directly after the `--pollute` block:

```js
// The generic pass was retired: the reviewed catalog covers its sites, and the
// pass re-submitted to brokers the catalog excludes. Refuse before any config
// is read, as for --pollute.
if (process.argv.includes('--generic')) {
  console.error('The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.');
  process.exit(1);
}
```

If the `bin` test still fails, check that `bin/upec-wipe.js` passes unknown flags through to `watcher.js` (it does for `--only`); if it rejects them first, add the same check at the top of `bin/upec-wipe.js` with the same text.

- [ ] **Step 4: Run it to verify it passes**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-retired.test.js`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/generic-retired.test.js
git commit -m "feat: refuse --generic: the generic pass was retired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Refuse `generic.enabled: true` in the run mode and in doctor

**Files:**
- Modify: `lib/submission-plan.js` (replace `isGenericEnabled`, lines 1-21 and the export)
- Modify: `lib/modes/run.js` (import line 17; right after `loadRunSetup(flags)` at line 37)
- Modify: `lib/doctor.js` (new check, `runDoctor` checks list, "running 6 checks" text, exports)
- Modify: `test/submission-plan.test.js` (lines 1-27: the two `isGenericEnabled` tests and the header line)
- Test: `test/generic-retired.test.js` (append)

**Interfaces:**
- Produces: `genericRetiredMessage(config) -> string | null` exported from `lib/submission-plan.js`. Returns the config refusal text when `config.generic.enabled === true`, else `null`.
- Produces: `checkRetiredSettings(cfg) -> Promise<{ ok: boolean, hint: string }>` exported from `lib/doctor.js`.
- Removes: `isGenericEnabled` (Task 4 deletes its last caller's use; this task already removes the export, so Task 2 must also drop it from the `run.js` import and the banner, see Step 3).

- [ ] **Step 1: Write the failing tests**

Append to `test/generic-retired.test.js`:

```js
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
  const bad = await checkRetiredSettings({ generic: { enabled: true } });
  assert.equal(bad.ok, false);
  assert.equal(bad.hint, CONFIG_MSG);
  assert.equal((await checkRetiredSettings({ generic: { enabled: false } })).ok, true);
  assert.equal((await checkRetiredSettings({})).ok, true);
});

test('runDoctor runs the retired-settings check', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'doctor.js'), 'utf8');
  assert.match(src, /name: 'retired',\s+run: \(\) => checkRetiredSettings\(cfg\)/);
  assert.match(src, /running 7 checks/);
});
```

In `test/submission-plan.test.js`, delete the two tests `generic pass is off by default` and `generic pass turns on with --generic or generic.enabled === true`, drop `isGenericEnabled` from the `require` on line 13, and change the header sentence "the generic pass is opt-in, and every web submission" to "every web submission".

- [ ] **Step 2: Run them to verify they fail**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-retired.test.js test/submission-plan.test.js`
Expected: the four new tests FAIL (`genericRetiredMessage is not a function`, `checkRetiredSettings is not a function`, no match in run.js and doctor.js). `submission-plan.test.js` passes.

- [ ] **Step 3: Implement**

`lib/submission-plan.js`: replace the `isGenericEnabled` header bullet and function with:

```js
 * - genericRetiredMessage: the generic pass was retired. A config that still
 *   turns it on is refused with this text rather than quietly ignored.
```

```js
const GENERIC_RETIRED = 'The generic pass was retired: remove the "generic" block from config.json. Its sites are in the reviewed catalog (data/catalog/).';

// Only enabled === true ever turned the pass on, so only that is refused.
function genericRetiredMessage(config) {
  return config && config.generic && config.generic.enabled === true ? GENERIC_RETIRED : null;
}
```

Export `genericRetiredMessage` in place of `isGenericEnabled`.

`lib/modes/run.js`:
- Line 17 becomes `const { genericRetiredMessage, buildSubmissionPlan, withSubmissionEmail } = require('../submission-plan');`
- Directly after `const { config, state, persons } = loadRunSetup(flags);`:

```js
  const retired = genericRetiredMessage(config);
  if (retired) {
    console.error(retired);
    return 1;
  }
```

- Line 145-146: replace `const GENERIC_ENABLED = isGenericEnabled(argv, config);` with `const GENERIC_ENABLED = false; // the pass is retired; Task 4 removes this branch`, and leave the banner line alone for now. (Task 4 deletes both.)

`lib/doctor.js`, after `checkConfig`:

```js
/**
 * Check: no setting that turns on a retired feature. Today that is the generic
 * pass (generic.enabled: true), which a run now refuses.
 *
 * @param {object} cfg
 * @returns {{ ok: boolean, hint: string }}
 */
async function checkRetiredSettings(cfg) {
  const { genericRetiredMessage } = require('./submission-plan');
  const msg = genericRetiredMessage(cfg);
  return msg ? { ok: false, hint: msg } : { ok: true, hint: 'no retired settings' };
}
```

In `runDoctor`: change `running 6 checks` to `running 7 checks`, and add after the config entry:

```js
    { name: 'retired',    run: () => checkRetiredSettings(cfg) },
```

Add `checkRetiredSettings` to `module.exports`.

- [ ] **Step 4: Run them to verify they pass**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-retired.test.js test/submission-plan.test.js test/doctor.test.js test/doctor-encrypted.test.js`
Expected: all pass. If `doctor.test.js` counts checks or names, update its expected list to include `retired` second.

- [ ] **Step 5: Commit**

```bash
git add lib/submission-plan.js lib/modes/run.js lib/doctor.js test/generic-retired.test.js test/submission-plan.test.js test/doctor.test.js
git commit -m "feat: refuse generic.enabled: true in runs and flag it in doctor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Move the dead-URL helpers to `lib/dead-urls.js`

**Files:**
- Create: `lib/dead-urls.js`
- Modify: `generic-runner.js` (lines 32 and 65-114: import instead of define)
- Modify: `scripts/catalog-candidates.js:14`
- Modify: `test/dead-url.test.js` (header and line 20)

**Interfaces:**
- Produces: `lib/dead-urls.js` exporting `{ DEAD_URLS_PATH, loadDeadSet(path) -> Set<string>, classifyNavError(message) -> string | null, isDeadStatus(code) -> boolean }`, moved unchanged.

- [ ] **Step 1: Record the candidates baseline**

Run: `node scripts/catalog-candidates.js && git diff --stat data/catalog/candidates.json`
Expected: `Candidates: 641 ...` and no diff. If there is a diff before any change, stop: it is unrelated drift; `git checkout data/catalog/candidates.json` and report it.

- [ ] **Step 2: Point the test at the new module (failing)**

In `test/dead-url.test.js`, line 20 becomes:

```js
const { classifyNavError, isDeadStatus, loadDeadSet } = require('../lib/dead-urls');
```

and the header's first paragraph becomes "Unit tests for the pure classification helpers in lib/dead-urls.js and for loadDeadSet (using temp files)." Drop the sentence about `processGenericUrl`.

Run: `node --test test/dead-url.test.js`
Expected: FAIL with `Cannot find module '../lib/dead-urls'`.

- [ ] **Step 3: Create the module**

`lib/dead-urls.js`: copy `DEAD_URLS_PATH` (as `path.join(__dirname, '..', 'data', 'dead-urls.json')`), `loadDeadSet`, `DEAD_ERROR_PATTERNS`, `classifyNavError` and `isDeadStatus` from `generic-runner.js` lines 32 and 65-114 with their comments, unchanged, under:

```js
'use strict';
/**
 * lib/dead-urls.js - the dead-site list (data/dead-urls.json) and the checks
 * that call a navigation error or HTTP status "dead". Used by the catalog
 * candidate builder; moved from generic-runner.js.
 */
const fs = require('fs');
const path = require('path');
```

and `module.exports = { DEAD_URLS_PATH, loadDeadSet, classifyNavError, isDeadStatus };`.

In `generic-runner.js`, delete those definitions and add:

```js
const { DEAD_URLS_PATH, loadDeadSet, classifyNavError, isDeadStatus } = require('./lib/dead-urls');
```

keeping `const deadSet = loadDeadSet(DEAD_URLS_PATH);` and the existing exports (Task 4 deletes the file).

`scripts/catalog-candidates.js:14` becomes:

```js
const { loadDeadSet, DEAD_URLS_PATH } = require(path.join(ROOT, 'lib/dead-urls'));
```

- [ ] **Step 4: Verify**

Run: `node --test test/dead-url.test.js && node scripts/catalog-candidates.js && git diff --stat data/catalog/candidates.json`
Expected: dead-url tests pass, `Candidates: 641`, no diff.

Run: `npm test`
Expected: all pass (generic-runner tests still run against the re-imported helpers).

- [ ] **Step 5: Commit**

```bash
git add lib/dead-urls.js generic-runner.js scripts/catalog-candidates.js test/dead-url.test.js
git commit -m "refactor: move the dead-URL helpers to lib/dead-urls.js

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Remove the generic pass

**Files:**
- Delete: `generic-runner.js`
- Delete tests: `test/allowlist-generic-runner.test.js`, `test/feeds-generic-runner.test.js`, `test/generic-runner-bugs.test.js`, `test/generic-catalog-exclusion.test.js`, `test/generic-selectors.test.js`, `test/generic-selectors.browser.test.js`, `test/generic-runner-false-success.test.js`, `test/generic-runner-egress.test.js`, `test/generic-runner-audit.test.js`, `test/generic-runner-leak.test.js`, `test/generic-runner-per-person.test.js`, `test/generic-runner-encryption.test.js`, `test/watcher-generic-hoist.test.js`
- Modify: `lib/modes/run.js` (line 137 require, lines 145-146 banner, lines 369-426 explicit-hosts and generic loop; drop `withSubmissionEmail` from the import if unused)
- Modify: `lib/logger.js` (lines 20, 58, 138-140, 161)
- Modify: `lib/catalog.js` (add `catalogFormSiteCount`)
- Modify: `package.json` (`files`: drop `generic-runner.js`)
- Modify: `config.example.json` (lines 54-57: delete the `generic` block)
- Modify: `scripts/cross-model-gate.sh:29`, `scripts/cross-model-review.sh:112` (drop `generic-runner.js`)
- Modify tests: `test/logger.test.js` (lines 239-275 and 363-367), `test/watcher-egress-wiring.test.js` (lines 15-25), `test/debug-output.test.js` (the two generic click tests and the import), `test/domain.test.js` (line 17 list entry, lines 24-27 test), `test/playwright-loader.test.js:28`, `test/umask-file-modes.test.js:91`
- Test: `test/generic-retired.test.js` (append)

**Interfaces:**
- Consumes: `genericRetiredMessage` (Task 2), `lib/dead-urls.js` (Task 3).
- Produces: `catalogFormSiteCount(records) -> number` in `lib/catalog.js`: the number of records whose `review.state` is `reviewed`, `manual` or `needs-review` (the ones a forms run lists).

- [ ] **Step 1: Write the failing tests**

Append to `test/generic-retired.test.js`:

```js
test('generic-runner.js is gone and nothing requires it', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'generic-runner.js')), false);
  const files = ['watcher.js', 'setup.js', 'brokers.js'];
  for (const dir of ['lib', 'lib/modes', 'bin', 'scripts', 'dashboard']) {
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-retired.test.js`
Expected: the four new tests FAIL.

- [ ] **Step 3: Remove the pass**

1. `git rm generic-runner.js` and the 13 test files listed above.
2. `lib/catalog.js`: add before `module.exports` and export it:

```js
// Records a forms run lists: reviewed forms, manual links, and needs-review
// sites (run as manual). Email records go through the email step instead.
function catalogFormSiteCount(records) {
  return (records || []).filter(r => r.review && ['reviewed', 'manual', 'needs-review'].includes(r.review.state)).length;
}
```

3. `lib/modes/run.js`:
   - Line 109: add `catalogFormSiteCount` to the `require('../catalog')` destructure.
   - Delete line 137 (`const { runGenericBrokers } = require('../../generic-runner');`).
   - Replace lines 145-146 (the `GENERIC_ENABLED` line from Task 2 and the banner) with:

```js
    console.log(`${brokers.length} explicit brokers + ${catalogFormSiteCount(catalogRecords)} catalog sites | re-check window: ${RECHECK_DAYS} days\n`);
```

   - Delete the block from `// Build the set of explicit broker hostnames so generic-runner can skip them.` through `results.genericStats = genericTotals;` (lines 369-426). If `catalogDomains` or `withSubmissionEmail` is then unused in the file, drop it from its import.
4. `lib/logger.js`: delete `genericStats: undefined,` (line 20), `results.genericStats = undefined;` (line 58), the `gs` and `genericLine` constants (lines 138-140) and `genericLine,` in the summary array (line 161).
5. `package.json`: remove `"generic-runner.js",` from `files`.
6. `config.example.json`: delete the `"generic": { ... },` block and the blank line after it.
7. `scripts/cross-model-gate.sh:29`: remove `generic-runner\.js|` from `TIER1_PATTERN`. `scripts/cross-model-review.sh:112`: remove `generic-runner.js` from the file list.
8. Tests:
   - `test/logger.test.js`: delete the `WP5: genericStats in summary` section (the four tests, lines 239-275) and `no generic line when the generic pass did not run` (lines 363-367).
   - `test/watcher-egress-wiring.test.js`: delete `a VPN drop in the generic pass stops the run cleanly`; in `both broker loops re-check the browser egress`, delete the line `assert.match(src, /recheckEgress: session\.recheckEgress/);` only if that text is no longer in `run.js` (check with grep first; the explicit loop may still pass it).
   - `test/debug-output.test.js`: delete the `_clickDoNotSell` import and the two tests that use it (`a failed generic click is shown under UPEC_WIPE_DEBUG...` and `without UPEC_WIPE_DEBUG a failed click stays quiet`). Keep `formatFatal` and any other tests.
   - `test/domain.test.js`: remove `'generic-runner.js', ` from the list on line 17 and delete the test `generic-runner takes RECHECK_DAYS from lib/config`.
   - `test/playwright-loader.test.js:28`: remove `'generic-runner.js', `.
   - `test/umask-file-modes.test.js:91`: remove `'generic-runner.js', ` from the copied files.

- [ ] **Step 4: Verify**

Run: `grep -rn "generic-runner\|runGenericBrokers\|isGenericEnabled\|genericStats" --include=*.js --include=*.sh --include=*.json . | grep -v node_modules`
Expected: only `test/generic-retired.test.js` (the assertion text) and nothing else.

Run: `npm test && node --test dashboard/*.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A lib/ test/ scripts/ package.json config.example.json
git commit -m "feat: remove the generic pass

The reviewed catalog covers its sites. Measured with the catalog dedupe, the
pass would visit 23 sites: broken registry rows, brokers the catalog already
handles or excludes (it matched on the opt-out host, not the broker's
domain), the CA DROP portal and one new broker (PureCars). The banner now
counts catalog sites.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Update the docs and help text

**Files:**
- Modify: `README.md` (line 70 options, line 78 coverage row, line 92 layout)
- Modify: `docs/REFERENCE.md` (lines 106-117 "Generic pass" section, the "Brokers covered" intro "three sources", line 235 update-brokers, line 239 pruning)
- Modify: `docs/UPEC-MANUAL.md:349` (options paragraph)
- Modify: `docs/PRIVACY.md:48` (the "About 490 other sites" row)
- Modify: `docs/THREAT-MODEL.md:13` (the "Generic pass off by default" row)
- Modify: `STATUS.md:25` and `STATUS.md:89`
- Modify: `docs/CROSS_MODEL_REVIEW.md:140` (tier-1 table: drop `generic-runner.js`; line 19 is a history entry, leave it)
- Modify: `docs/CATALOG-REVIEW.md:3` ("from the generic lists" -> "from the public broker lists")
- Modify: `dashboard/public/index.html:94` ("Network, relay, generic, browser" -> "Network, relay, browser")
- Modify: `lib/feeds.js` comments (lines 8, 30, 198, 285) and `lib/modes/update-brokers.js:12`
- Test: `test/generic-retired.test.js` (append)

- [ ] **Step 1: Write the failing test**

Append to `test/generic-retired.test.js`:

```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-retired.test.js`
Expected: the two new tests FAIL, naming README.md first.

- [ ] **Step 3: Edit the docs**

- `README.md`:
  - Line 70: delete `, \`--generic\` (also try about 490 unreviewed sites; off by default)`.
  - Line 78: delete the `**Generic pass**` row.
  - Line 92: delete the `generic-runner.js` layout line.
- `docs/REFERENCE.md`:
  - "UPEC-WIPE works through three sources, in this order." -> "UPEC-WIPE works through two sources, in this order."
  - Replace the whole `### 3. Generic pass ...` section (heading through the cookie-manager paragraph) with:

```markdown
### Retired: the generic pass

Earlier versions had an opt-in heuristic pass over about 500 sites from The Markup, BADBOOL and the state registries (`--generic`). The reviewed catalog now covers those lists, and the pass matched sites by their opt-out page's host rather than the broker's own domain, so it re-submitted to brokers the catalog handles or excludes. It was retired on 2026-10-13. `--generic`, or `generic.enabled: true` in `config.json`, now stops with "The generic pass was retired" and sends nothing; remove the flag or the `generic` block. The source lists stay as catalog inputs.
```

  - Update-brokers paragraph: replace "and writes `data/feeds-brokers.json` for the generic pass. Entries that are not `https` are dropped. A failed refresh never reduces coverage: the bundled lists stay as the fallback." with "and writes `data/feeds-brokers.json`, which `scripts/catalog-candidates.js` reads with the bundled lists to find sites for the catalog. Entries that are not `https` are dropped."
  - Pruning paragraph: "Many of the older generic URLs now 404 or fail DNS." -> "Many URLs in the older public lists now 404 or fail DNS." and "It reads every `logs/run-*.json`" stays; add at the end: "The catalog candidate builder skips hosts on this list."
- `docs/UPEC-MANUAL.md:349`: delete ` and \`--generic\` (also try about 490 smaller sites from public lists; off by default because nobody reviewed them)` and make the preceding `--no-capsolver (treat CAPTCHA brokers as manual)` the last item ("... `--retry-failed` (...) and `--no-capsolver` (...)").
- `docs/PRIVACY.md:48`: replace the row with `| Sites from the public broker lists | Nothing: the generic pass that sent your details to them was retired. Reviewed sites run through the catalog rows above. | Never. |` (keep the table's column count; check the header first).
- `docs/THREAT-MODEL.md:13`: replace the row with `| Generic pass retired | Your data going to unreviewed sites from public lists or the state registries. Only reviewed catalog records run, and a leftover \`--generic\` or \`generic.enabled: true\` stops the run. | Nothing to add: the pass is gone. |`
- `STATUS.md:25`: "The other ~490 brokers in `data/markup-parsed.json` and `data/badbool-extra.json` are handled by the heuristic generic runner - every one of those is best-effort." -> "Sites from the public broker lists are in the reviewed catalog (`data/catalog/`); see docs/CATALOG-REVIEW.md." Keep the rest of the line. Line 89: replace the `Generic runner (~490 sites)` row with `| Reviewed catalog | Per record | Reviewed forms, manual links and email requests; re-checked by \`upec-wipe catalog-check\`. |`.
- `docs/CROSS_MODEL_REVIEW.md:140`: `` `generic-runner.js`, `lib/broker-runner.js`, `brokers.js` `` -> `` `lib/broker-runner.js`, `brokers.js` ``.
- `docs/CATALOG-REVIEW.md:3`: "from the generic lists" -> "from the public broker lists".
- `dashboard/public/index.html:94`: "Network, relay, generic, browser and profileDir settings" -> "Network, relay, browser and profileDir settings".
- `lib/feeds.js` comments: line 8 "normalizes each row to the generic broker" -> "normalizes each row to a catalog-source"; line 30 "registry rows decide where the generic pass sends personal data, so" -> "registry rows decide which sites the catalog survey visits, so"; line 198 "into a generic broker entry" -> "into a catalog-source entry"; line 285 "generic pass never navigates" -> "catalog survey never visits". Read each comment in full and keep it grammatical.
- `lib/modes/update-brokers.js:12`: "writes the feed file consumed by generic-runner.js. Markup data remains the" -> "writes the feed file that scripts/catalog-candidates.js reads. Markup data remains the" (read the next line and keep the sentence whole).

- [ ] **Step 4: Verify**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-retired.test.js test/docs-commands.test.js test/upec-docs.test.js test/no-em-dashes.test.js`
Expected: all pass.

Run: `npm test && node --test dashboard/*.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add README.md STATUS.md docs/REFERENCE.md docs/UPEC-MANUAL.md docs/PRIVACY.md docs/THREAT-MODEL.md docs/CROSS_MODEL_REVIEW.md docs/CATALOG-REVIEW.md dashboard/public/index.html lib/feeds.js lib/modes/update-brokers.js test/generic-retired.test.js
git commit -m "docs: the generic pass is retired

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Add PureCars to the catalog

Needs the member: the survey visits purecars.com and must go through Mullvad. Ask the member to confirm Mullvad is connected before Step 3.

**Files:**
- Modify: `data/catalog/candidates.json` (regenerated)
- Create: `data/catalog/purecars.com.json` (written by the survey)

- [ ] **Step 1: Find why PureCars is not a candidate**

Run: `node -e "const c=require('./data/catalog/candidates.json');console.log(c.some(x=>x.domain==='purecars.com'))"`
Expected: `false`. Its Markup row's URL is a `docs.google.com` form and it has no `website`, so `buildCandidates` keys it as `google.com` (checked while writing this plan: `buildCandidates({rows:[{name:'PureCars',url:'https://docs.google.com/forms/d/e/x',source:'markup'}]})` returns domain `google.com`), and `google.com` is dropped because the explicit Google brokers in `brokers.js` cover that domain. There is no `data/catalog/google.com.json`.

- [ ] **Step 2: Add the candidate**

Do not change `buildCandidates` (keying a form-host row by its broker needs a `website` the Markup row does not have). Instead add one entry to `data/catalog/candidates.json` in sorted position:

```json
{
 "domain": "purecars.com",
 "name": "PureCars Technologies, LLC",
 "urls": ["https://docs.google.com/forms/d/e/1FAIpQLSdXAQsI4b0angLCONbwT4B4YSFiPyVMMLzizCuBSnPZmsTp_g"],
 "sources": ["markup"],
 "contacts": [],
 "formHosts": ["google.com"]
}
```

Match the existing file's indentation (`JSON.stringify(candidates, null, 1)`), then run `node -e "JSON.parse(require('fs').readFileSync('data/catalog/candidates.json','utf8'))"` to confirm it parses. Note: re-running `scripts/catalog-candidates.js` later would drop this entry; say so in the commit message.

- [ ] **Step 3: Survey only PureCars (Mullvad on)**

Run: `node scripts/catalog-survey.js --only purecars.com`
Expected: one site surveyed, read-only, and `data/catalog/purecars.com.json` written with `review.state` `unreviewed`. If the survey refuses because Mullvad is off, stop and ask the member.

- [ ] **Step 4: Verify**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-files.test.js && git status --short data/catalog`
Expected: catalog tests pass; only `candidates.json` and `purecars.com.json` changed.

- [ ] **Step 5: Commit**

```bash
git add data/catalog/candidates.json data/catalog/purecars.com.json
git commit -m "data(catalog): add PureCars as a surveyed, unreviewed site

Its opt-out is a Google Form, so the candidate builder drops it as a shared
host; it is added by hand with formHosts google.com. Re-running
scripts/catalog-candidates.js drops it again until the builder learns
Markup rows without a website.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Finish

- [ ] `npm test` and `node --test dashboard/*.test.js` green on the branch head.
- [ ] Personal-data check before any push: count-only, printing no values, across the branch's commit messages and added lines.
- [ ] Ask the member how to publish (fast-forward `upec/hardening` and push, as before, or a PR).
