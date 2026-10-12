# Plan B: Write Paths, Small Fixes and Watcher Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `saveState` write once and `fillForm` make half the browser calls, fix the five small issues left by Plan A, give each person their own broker runner, and turn `watcher.js` into a short entry point that runs one file per mode.

**Architecture:** Tasks 1-4 are local, test-first changes. Task 5 adds two pure modules: flag parsing (`lib/cli-flags.js`) and mode picking (`lib/mode-dispatch.js` `pickMode`). Task 6 moves every mode block out of `watcher.js` verbatim into `lib/modes/<mode>.js` (mechanical edits only), rewrites `watcher.js` as the dispatcher, and repoints the tests that read `watcher.js` source. Task 7 turns the two remaining wiring checks into behaviour tests.

**Tech Stack:** Node.js 20+ (CommonJS), Playwright 1.60, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-12-watcher-restructure-design.md`

## Global Constraints

- Branch: `upec/watcher-restructure` off local `upec/hardening` (4dd16f2). Never push; never force-push.
- Read `CLAUDE.md` first. Never run `setup.js`, `upec-wipe run`, `--email`, `--know` or `preview` with the real config. Never read, print, copy or commit `config.json`, `config.json.enc`, `state.json`, `logs/`, `secrets/`.
- Tests use the dummy person (Jane Doe, Austin TX, `jane.doe@example.com`). No real personal data anywhere.
- Plain hyphens only: no em dash (U+2014) or en dash (U+2013) in tracked files. No emoji (Extended_Pictographic) in non-test JS.
- Full suite: `npm test` (about 80 s). Dashboard tests: `node --test dashboard/*.test.js`. If only `test/cli-dashboard-boot.test.js` fails under load, re-run it alone.
- Single test file: `node --require ./test/helpers/egress-off.js --test test/<file>.test.js`
- Commit messages end with a `Co-Authored-By:` trailer naming the model that wrote the commit.
- Behaviour of every command stays the same unless a task says otherwise. The privacy rules are the product.

## Review Focus

- A `.bak` that shares the state file's inode must never be written in place: a crash during a bind-mount fallback rewrite would then corrupt both copies. Pinned in Task 1.
- Playwright's `isVisible()` on a locator that matches nothing returns false (it does not throw), so dropping `count()` keeps the "not on this page" path. Pinned in Task 2 (absent-field test).
- `--list --report` still runs `--list` (early modes win before the conflict check), and `--doctor --report` is still refused. Pinned in Task 5.
- A mode file that forgets a `require` fails only when that mode runs. Every mode is loaded at least once by Task 6's load test.
- `watcher.js` with no flags still runs the opt-out run, and the opt-out run still ends without calling `process.exit` (so `process.exitCode` set inside it is kept). Pinned in Task 6.

---

### Task 1: `saveState` writes the data once

**Files:**
- Modify: `lib/config.js` (`_renameOrRewrite`, `saveState`)
- Test: `test/config-reliability.test.js`

**Interfaces:**
- Produces: `_renameOrRewrite(tmp, target, data, beforeRewrite?) -> boolean`: true when renamed, false when it fell back to an in-place write. `beforeRewrite()` runs just before an in-place write.

- [ ] **Step 1: Write the failing tests**

Append to `test/config-reliability.test.js` (it already has `cfg`, `fs`, `os`, `path`, `test`, `assert`; follow the existing tests' pattern of `cfg.setTestStatePath(...)` in a temp dir and resetting it in `finally`):

```js
test('saveState: the .bak is a hard link to the saved file, not a second write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-bak-link-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realWriteFileSync = fs.writeFileSync;
  let writeFileCalls = 0;
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__link_test__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    fs.writeFileSync = (...a) => { writeFileCalls++; return realWriteFileSync(...a); };
    cfg.saveState();
    fs.writeFileSync = realWriteFileSync;
    assert.equal(writeFileCalls, 0, 'no second data write for the .bak');
    assert.equal(fs.statSync(bakPath).ino, fs.statSync(statePath).ino, '.bak shares the inode of state.json');
    assert.equal(fs.readFileSync(bakPath, 'utf8'), fs.readFileSync(statePath, 'utf8'));
  } finally {
    fs.writeFileSync = realWriteFileSync;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveState: an in-place fallback never writes through a .bak that shares the inode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-bak-detach-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realRename = fs.renameSync;
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__a__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    cfg.saveState(); // linked .bak
    const linkedIno = fs.statSync(statePath).ino;
    let bakDuringRewrite = null;
    // Make the primary rename fail like a bind-mounted file, and look at the
    // .bak at the moment the in-place write happens.
    fs.renameSync = (from, to) => {
      if (to === statePath) {
        bakDuringRewrite = { ino: fs.statSync(bakPath).ino, text: fs.readFileSync(bakPath, 'utf8') };
        const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e;
      }
      return realRename(from, to);
    };
    cfg.loadState().optOuts.__b__ = { lastSuccess: '2026-01-02T00:00:00.000Z' };
    cfg.saveState();
    fs.renameSync = realRename;
    assert.ok(bakDuringRewrite, 'the fallback ran');
    assert.notEqual(bakDuringRewrite.ino, linkedIno, '.bak was detached before the in-place write');
    assert.ok(bakDuringRewrite.text.includes('__a__') && !bakDuringRewrite.text.includes('__b__'), '.bak held the old state during the write');
    assert.ok(fs.readFileSync(statePath, 'utf8').includes('__b__'));
    assert.ok(fs.readFileSync(bakPath, 'utf8').includes('__b__'));
  } finally {
    fs.renameSync = realRename;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

Note on the second test: today `.bak` is never a hard link, so the "detached" assertion already holds before the change; it pins the safety rule the change must keep. The first test is the RED one.

- [ ] **Step 2: Run them to see the first fail**

Run: `node --require ./test/helpers/egress-off.js --test test/config-reliability.test.js`
Expected: FAIL on `the .bak is a hard link ...` (`writeFileCalls` is 1 and the inodes differ).

- [ ] **Step 3: Implement**

In `lib/config.js` replace `_renameOrRewrite` with:

```js
function _renameOrRewrite(tmp, target, data, beforeRewrite) {
  try {
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EXDEV' && err.code !== 'EPERM') throw err;
    if (typeof beforeRewrite === 'function') beforeRewrite();
    fs.writeFileSync(target, data, { mode: OWNER_ONLY });
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}
```

Add above `saveState`:

```js
// A .bak that is a hard link of `target` shares its inode. Before anything
// writes `target` in place, give the .bak its own copy of the old state, or an
// interrupted write would truncate both.
function _detachBak(target, bak) {
  try {
    if (fs.statSync(bak).ino !== fs.statSync(target).ino) return;
    const bakTmp = bak + '.tmp';
    fs.copyFileSync(target, bakTmp);
    fs.renameSync(bakTmp, bak);
  } catch (_) {
    // No .bak or no target yet: nothing shares an inode.
  }
}
```

In `saveState`, change the primary write line `_renameOrRewrite(tmp, target, data);` to

```js
  const renamed = _renameOrRewrite(tmp, target, data, () => _detachBak(target, bak));
```

and replace the whole `(b)` block (the comment and its `try { fs.writeFileSync(bakTmp, ...) ... } catch (_) { ... }`) with:

```js
  // (b) The .bak is a hard link to the file just written: the same bytes with
  //     no second write. Linked via its own tmp + rename, so a kill mid-backup
  //     never leaves a truncated .bak. Falls back to writing the data where
  //     hard links are not available, or where the primary was rewritten in
  //     place (its inode must not be shared).
  try {
    try { fs.unlinkSync(bakTmp); } catch (_) {}
    let linked = false;
    if (renamed) {
      try { fs.linkSync(target, bakTmp); linked = true; } catch (_) { linked = false; }
    }
    if (!linked) fs.writeFileSync(bakTmp, data, { mode: OWNER_ONLY });
    _renameOrRewrite(bakTmp, bak, data);
    _chmodOwnerOnly(bak);
  } catch (_) {
    // Best-effort: if the backup fails we still have the primary.
    try { fs.unlinkSync(bakTmp); } catch (__) {}
  }
```

`writeFileFsync` keeps calling `_renameOrRewrite(tmp, target, data)` and ignores the return value.

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/config-reliability.test.js test/config-atomic-write.test.js test/config-bindmount-write.test.js test/config.test.js test/file-permissions.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/config.js test/config-reliability.test.js
git commit -m "perf(state): the .bak is a hard link, so each save writes the data once"
```

---

### Task 2: `fillForm` makes two browser calls per field

**Files:**
- Modify: `lib/forms.js` (`fillForm`)
- Test: `test/forms-fill-report.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/forms-fill-report.test.js` (add `const { fillForm } = require('../lib/forms');` only if the file does not already import it):

```js
test('one filled field costs one visibility check and one evaluate before the fill', async () => {
  const calls = [];
  const el = {
    first: () => el,
    count: async () => { calls.push('count'); return 1; },
    isVisible: async () => { calls.push('isVisible'); return true; },
    evaluate: async (fn) => { calls.push('evaluate'); return fn({ tagName: 'INPUT', type: 'text' }); },
    fill: async () => { calls.push('fill'); },
  };
  const page = { locator: () => el };
  const r = await fillForm(page, { 'input[name="firstName"]': 'Jane' });
  assert.equal(r.filled.length, 1);
  assert.deepEqual(calls, ['isVisible', 'evaluate', 'fill']);
});

test('a field that is not on the page is reported missed without an evaluate', async () => {
  const calls = [];
  const el = {
    first: () => el,
    count: async () => { calls.push('count'); return 0; },
    isVisible: async () => { calls.push('isVisible'); return false; },
    evaluate: async () => { calls.push('evaluate'); throw new Error('no element'); },
  };
  const page = { locator: () => el, getByLabel: () => ({ count: async () => 0 }), evaluate: async () => null };
  const r = await fillForm(page, { 'input[name="firstName"]': 'Jane' });
  assert.deepEqual(r.missed, ['input[name="firstName"]']);
  assert.ok(!calls.includes('evaluate'));
});
```

If the resolver fallback (`lib/field-resolver.js` `resolveField`) needs more page methods than this stub has, it already catches its own errors (`resolveField(...).catch(() => null)`); if the stub still throws, add the missing no-op method to the stub page.

- [ ] **Step 2: Run them to see the first fail**

Run: `node --require ./test/helpers/egress-off.js --test test/forms-fill-report.test.js`
Expected: FAIL on the first test (calls are `count, isVisible, evaluate, evaluate, fill`).

- [ ] **Step 3: Implement**

In `lib/forms.js`, above `applyValue`, add:

```js
// Tag and input type in one browser round trip.
function kindInfo(el) {
  return el.evaluate(n => ({ tag: n.tagName.toLowerCase(), type: n.type || '' }));
}
```

In `fillForm`'s selector loop replace

```js
        if (report.filled.some(f => f.kind === 'checkbox') && !((await el.count()) > 0 && (await el.isVisible()))) {
          await Promise.resolve().then(() => el.waitFor({ state: 'visible', timeout: 2000 })).catch(() => {});
        }
        if ((await el.count()) > 0 && (await el.isVisible())) {
          const tag  = await el.evaluate(n => n.tagName.toLowerCase());
          const type = await el.evaluate(n => n.type || '');
```

with

```js
        // isVisible() is false when nothing matches, so no count() is needed.
        if (report.filled.some(f => f.kind === 'checkbox') && !(await el.isVisible())) {
          await Promise.resolve().then(() => el.waitFor({ state: 'visible', timeout: 2000 })).catch(() => {});
        }
        if (await el.isVisible()) {
          const { tag, type } = await kindInfo(el);
```

In the label fallback replace

```js
          const tag  = await Promise.resolve().then(() => target.evaluate(n => n.tagName.toLowerCase())).catch(() => '');
          const type = await Promise.resolve().then(() => target.evaluate(n => n.type || '')).catch(() => '');
```

with

```js
          const { tag, type } = await Promise.resolve().then(() => kindInfo(target)).catch(() => ({ tag: '', type: '' }));
```

In the resolver fallback replace

```js
          const tag  = await resolved.evaluate(n => n.tagName.toLowerCase()).catch(() => '');
          const type = await resolved.evaluate(n => n.type || '').catch(() => '');
```

with

```js
          const { tag, type } = await kindInfo(resolved).catch(() => ({ tag: '', type: '' }));
```

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/forms*.test.js test/broker-runner-*.test.js test/field-resolver.test.js`, then `npm test`, then `UPEC_WIPE_BROWSER_TESTS=1 node --test test/field-resolver.browser.test.js`.
Expected: PASS. If a test's stub page answers `evaluate` by inspecting the function text (for example returning a tag for one call and a type for the next), change that stub to call `fn` with a node object (`fn({ tagName: 'INPUT', type: 'text' })`), which is what real Playwright does, and say so in the commit body. If a stub returns `isVisible() === true` while `count() === 0`, make it consistent (real Playwright returns false when nothing matches).

- [ ] **Step 5: Commit**

```bash
git add lib/forms.js test/
git commit -m "perf(forms): one visibility check and one evaluate per field"
```

---

### Task 3: Small issues left by Plan A

**Files:**
- Modify: `lib/email-step.js` (`buildEmailPlan`), `lib/right-to-know-runner.js` (`buildKnowPlan`), `watcher.js` (`--reply` block, `PREVIEW_ALIAS_NOTE`), `lib/catalog.js` (one require), `lib/captcha.js` (blank lines), `lib/cli-map.js` (reply description), `docs/UPEC-MANUAL.md` (reply row)
- Test: `test/email-run-step.test.js`, `test/right-to-know-step.test.js`, create `test/reply-right-to-know.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/email-run-step.test.js`:

```js
test('a logged bounce moves a sent email to manual', async () => {
  const state = { optOuts: {}, emailSent: { Alpha: { to: 'p@alpha.com', at: 't', messageId: 'm' } }, emailReplies: { Alpha: { outcome: 'bounced', at: 't' } } };
  const { d, out } = deps({ state });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 0);
  assert.match(out.lines.join('\n'), /manual Alpha: email to p@alpha\.com failed or bounced/);
});
```

Append to `test/right-to-know-step.test.js`:

```js
test('a logged bounce moves a sent know request to manual', () => {
  const manual = [];
  const state = {
    emailSent: { [`${KNOW_PREFIX}Pipl`]: { to: 'privacy@pipl.com', at: 't', messageId: 'm' } },
    emailReplies: { [`${KNOW_PREFIX}Pipl`]: { outcome: 'bounced', at: 't' } },
  };
  const items = buildKnowPlan({ brokers: BROKERS, persons: [P], state, submissionEmailFor: () => ALIAS, blockedPersons: new Set(), maxPerRun: 100, manual });
  assert.deepEqual(items, []);
  assert.deepEqual(manual, [{ name: 'Pipl', to: 'privacy@pipl.com' }]);
});
```

Create `test/reply-right-to-know.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WATCHER = path.join(__dirname, '..', 'watcher.js');

function runReply(args, initialState) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-reply-'));
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(initialState));
  const r = spawnSync(process.execPath, [WATCHER, '--reply', ...args], {
    env: { ...process.env, UPEC_WIPE_STATE_PATH: statePath }, encoding: 'utf8', timeout: 60000,
  });
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { r, state };
}

test('reply --right-to-know logs against the know: key', () => {
  const { r, state } = runReply(['Pipl', 'bounced', '--right-to-know'], {
    optOuts: {}, emailSent: { 'know:Pipl': { to: 'privacy@pipl.com', at: 't', messageId: 'm' } },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(state.emailReplies['know:Pipl'].outcome, 'bounced');
  assert.equal(state.emailReplies.Pipl, undefined);
});

test('reply without the flag still logs against the deletion email key', () => {
  const { r, state } = runReply(['Pipl', 'honored'], {
    optOuts: {}, emailSent: { Pipl: { to: 'privacy@pipl.com', at: 't', messageId: 'm' } },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(state.emailReplies.Pipl.outcome, 'honored');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/email-run-step.test.js test/right-to-know-step.test.js test/reply-right-to-know.test.js`
Expected: FAIL on the three new behaviour tests (the second reply test passes already).

- [ ] **Step 3: Implement**

`lib/email-step.js` `buildEmailPlan`, replace

```js
      const s = sent[key];
      if (s && s.status === 'unknown') { plan.unknown.push(item); continue; }
      if (s) continue;
      if ((failures[key] || 0) >= 2 || (replies[key] && replies[key].outcome === 'bounced')) { plan.manual.push(item); continue; }
```

with

```js
      const s = sent[key];
      // A logged bounce: the address does not work, whether or not it was sent.
      if (replies[key] && replies[key].outcome === 'bounced') { plan.manual.push(item); continue; }
      if (s && s.status === 'unknown') { plan.unknown.push(item); continue; }
      if (s) continue;
      if ((failures[key] || 0) >= 2) { plan.manual.push(item); continue; }
```

`lib/right-to-know-runner.js` `buildKnowPlan`, replace

```js
      if (sent[key]) continue;
      // Recorded by the old sender (SMTP or printed template): already asked.
      if (optOuts[sk] && optOuts[sk].knowRequestedAt) continue;
      // Two failed sends or a logged bounce: a person has to check the address.
      if ((failures[key] || 0) >= 2 || (replies[key] && replies[key].outcome === 'bounced')) {
        if (manual) manual.push({ name: broker.name, to });
        continue;
      }
```

with

```js
      // A logged bounce: the address does not work, whether or not it was sent.
      if (replies[key] && replies[key].outcome === 'bounced') {
        if (manual) manual.push({ name: broker.name, to });
        continue;
      }
      if (sent[key]) continue;
      // Recorded by the old sender (SMTP or printed template): already asked.
      if (optOuts[sk] && optOuts[sk].knowRequestedAt) continue;
      // Two failed sends: a person has to check the address.
      if ((failures[key] || 0) >= 2) {
        if (manual) manual.push({ name: broker.name, to });
        continue;
      }
```

`watcher.js` `--reply` block, replace from `if (!REPLY_OUTCOMES.includes(outcome)) {` through the `console.log(\`${found.name}: reply logged as ${outcome}.\`);` line with:

```js
  if (!REPLY_OUTCOMES.includes(outcome)) {
    console.error(`Usage: upec-wipe reply <broker> ${REPLY_OUTCOMES.join('|')} [--right-to-know]`);
    process.exit(2);
  }
  // --right-to-know: the reply answers a right-to-know request ("know:" keys),
  // which only the email brokers in brokers.js receive.
  const forKnow = process.argv.includes('--right-to-know');
  const prefix = forKnow ? require('./lib/right-to-know-runner').KNOW_PREFIX : '';
  const names = forKnow
    ? brokersList.filter(b => b.method === 'email' && b.emailTo).map(b => b.name)
    : [
      ...catalogEmailTargets(loadCatalog(undefined, () => {}), { explicitNames: new Set(brokersList.map(b => b.name.toLowerCase())) }).map(t => t.name),
      ...brokersList.filter(b => b.method === 'email').map(b => b.name),
    ];
  const found = findEmailTarget(names, query);
  if (found.error) { console.error(found.error); process.exit(2); }
  const replyLock = acquireStateLockOrExit();
  try {
    // Reload under the lock: a run may have written state since this process started.
    const st = require('./lib/config').resetState();
    const base = prefix + found.name;
    const keys = Object.keys(st.emailSent || {}).filter(k => k === base || k.startsWith(`${base}|`));
    for (const key of (keys.length ? keys : [base])) recordReply(st, key, outcome);
    saveState();
  } finally {
    lock.release(replyLock);
  }
  console.log(`${found.name}: ${forKnow ? 'right-to-know ' : ''}reply logged as ${outcome}.`);
```

`watcher.js`: change `PREVIEW_ALIAS_NOTE` to
``const PREVIEW_ALIAS_NOTE = `Note: no SimpleLogin alias exists yet, so this preview or dry run uses ${PREVIEW_ALIAS} as a stand-in. A real run creates the alias.`;``

`lib/catalog.js`: change `const { BARE_SUFFIXES } = require('./catalog-sources');` to take `BARE_SUFFIXES` from `./domain` (merge it into the existing `require('./domain')` line: `const { hostnameOf, registrableDomain, BARE_SUFFIXES } = require('./domain');`) and delete the `catalog-sources` require if nothing else uses it.

`lib/captcha.js`: where two blank lines sit above the `solveWithCapSolver` JSDoc, leave one.

`lib/cli-map.js` `reply` description: `'Log a broker reply to an email request: upec-wipe reply <broker> honored|refused|verify|none|bounced [--right-to-know]'`.

`docs/UPEC-MANUAL.md` `reply` row: after the usage, add `Add --right-to-know when the reply answers a right-to-know request.`

- [ ] **Step 4: Run the tests**

Run: the Step 2 command plus `test/cli-map.test.js test/catalog*.test.js test/captcha.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email-step.js lib/right-to-know-runner.js watcher.js lib/catalog.js lib/captcha.js lib/cli-map.js docs/UPEC-MANUAL.md test/email-run-step.test.js test/right-to-know-step.test.js test/reply-right-to-know.test.js
git commit -m "fix: bounces move sent requests to manual; reply --right-to-know; small tidy-ups"
```

---

### Task 4: One broker runner per person

**Files:**
- Modify: `lib/broker-runner.js`
- Test: create `test/broker-runner-instances.test.js`

**Interfaces:**
- Produces: `createBrokerRunner(options) -> { processBroker(context, broker), processBrokerWithPerson(context, broker, person), appliesToPerson }`. `options` has the same keys `configure()` takes. `configure`, `processBroker`, `processBrokerWithPerson`, `appliesToPerson` stay exported unchanged.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBrokerRunner } = require('../lib/broker-runner');
const { results } = require('../lib/logger');
const config = require('../lib/config');

test('two runners keep their own options', async () => {
  config.setDryRun(true); // no checkpoint or state written
  try {
    const broker = { name: 'Acme', method: 'manual', notes: 'by hand' };
    const keep = createBrokerRunner({ config: { allowlist: ['Acme'] }, person: { firstName: 'Jane', lastName: 'Doe' } });
    const run = createBrokerRunner({ config: { allowlist: [] }, person: { firstName: 'Jane', lastName: 'Doe' } });
    const skippedBefore = results.skipped.length;
    const manualBefore = results.manual.length;
    await keep.processBroker({}, broker);
    await run.processBroker({}, broker);
    assert.equal(results.skipped.length - skippedBefore, 1, 'the allowlisting runner skipped it');
    assert.equal(results.manual.length - manualBefore, 1, 'the other runner did not inherit the allowlist');
  } finally {
    config.setDryRun(false);
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --require ./test/helpers/egress-off.js --test test/broker-runner-instances.test.js`
Expected: FAIL (`createBrokerRunner is not a function`).

- [ ] **Step 3: Implement**

In `lib/broker-runner.js` replace

```js
let opts = { dryRun: false, person: null, capsolver: null, noCapsolver: false, snapshot: false, personCount: 1, config: null, submissionEmail: null };

function configure(o) {
  opts = { ...opts, ...o };
}
```

with

```js
const DEFAULT_OPTIONS = { dryRun: false, person: null, capsolver: null, noCapsolver: false, snapshot: false, personCount: 1, config: null, submissionEmail: null };

// The default runner, kept for older callers and tests: configure() changes it.
let opts = { ...DEFAULT_OPTIONS };

function configure(o) {
  opts = { ...opts, ...o };
}

/**
 * A runner bound to one set of options (one person in one run). Two runners
 * never share options, so one person's settings cannot leak into another's.
 */
function createBrokerRunner(options) {
  const own = { ...DEFAULT_OPTIONS, ...options };
  return {
    processBroker: (context, broker) => runBroker(own, context, broker, own.person),
    processBrokerWithPerson: (context, broker, person) => runBroker(own, context, broker, person),
    appliesToPerson,
  };
}
```

Change `processBroker` to `return runBroker(opts, context, broker, opts.person);`. Rename the existing `async function processBrokerWithPerson(context, broker, person) {` to `async function runBroker(opts, context, broker, person) {` (its body is unchanged: its `opts.` references now read the parameter), keep its JSDoc and add `@param {object} opts - runner options` to it, and add:

```js
async function processBrokerWithPerson(context, broker, person) {
  return runBroker(opts, context, broker, person);
}
```

Export: `module.exports = { configure, processBroker, processBrokerWithPerson, appliesToPerson, createBrokerRunner };`

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/broker-runner-*.test.js test/allowlist-broker-runner.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/broker-runner.js test/broker-runner-instances.test.js
git commit -m "refactor(broker-runner): createBrokerRunner binds options to one runner"
```

---

### Task 5: Flag parsing and mode picking as pure modules

**Files:**
- Create: `lib/cli-flags.js`, `test/cli-flags.test.js`
- Modify: `lib/mode-dispatch.js` (add `pickMode`)
- Test: `test/watcher-mode-dispatch.test.js` (append)

**Interfaces:**
- Produces: `parseWatcherFlags(argv) -> flags` with exactly these keys: `PREVIEW, EMAIL, FORMS, ASSIST, DRY_RUN, VERIFY, SERP_SCAN, SERP_WATCH, DOCTOR, ONLY_ARG, SKIP_ARG, RETRY_FAILED, LIST_MODE, SCORE_MODE, PENDING_MODE, UPDATE_BROKERS, BREACH_CHECK, NO_CAPSOLVER, RESUME, SNAPSHOT, REPORT, ENCRYPT_CONFIG, DECRYPT_CONFIG, KEEP_PLAINTEXT, KNOW_MODE, KNOW_STATUS, COMPLAINTS_MODE, FREEZE_LIST, FREEZE_DONE_KEY, FREEZE_CLEAR_KEY, FREEZE_MODE, CONFIRM_EMAILS, confirmEmailsDir, REPLY, ALLOWLIST_CMD`.
- Produces: `pickMode(flags) -> { mode: string|null, conflict: string|null }`, mode one of `freeze, encrypt-config, list, reply, score, pending, allowlist, know-status, breach, complaints, confirm-emails, report, doctor, update-brokers, know, run`.

- [ ] **Step 1: Write the failing tests**

Create `test/cli-flags.test.js`:

```js
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
  assert.equal(p('--freeze-done', 'equifax').FREEZE_DONE_KEY, 'equifax');
  assert.equal(p('--freeze-done', 'equifax').FREEZE_MODE, true);
  assert.equal(p('--confirm-emails', 'mail').confirmEmailsDir, 'mail');
  assert.equal(p('--confirm-emails', '--dry-run').confirmEmailsDir, './inbox/confirms');
});

test('doctor as the first argument or as a flag', () => {
  assert.equal(p('doctor').DOCTOR, true);
  assert.equal(p('--doctor').DOCTOR, true);
});

test('--know-status is not --know, and --allow is parsed', () => {
  assert.equal(p('--know-status').KNOW_MODE, false);
  assert.equal(p('--allow', 'Spokeo').ALLOWLIST_CMD.name, 'Spokeo');
  assert.equal(p().ALLOWLIST_CMD, null);
});
```

Append to `test/watcher-mode-dispatch.test.js`:

```js
const { pickMode } = require('../lib/mode-dispatch');
const { parseWatcherFlags } = require('../lib/cli-flags');
const pick = (...args) => pickMode(parseWatcherFlags(['node', 'watcher.js', ...args]));

test('pickMode: no mode flag is the opt-out run', () => {
  assert.deepEqual(pick(), { mode: 'run', conflict: null });
});

test('pickMode: early read-only modes win before the conflict check', () => {
  assert.equal(pick('--list', '--report').mode, 'list');
  assert.equal(pick('--freeze', '--doctor').mode, 'freeze');
});

test('pickMode: later modes that conflict are refused', () => {
  const r = pick('--doctor', '--report');
  assert.equal(r.mode, null);
  assert.match(r.conflict, /--report, --doctor|--doctor, --report/);
});

test('pickMode: each later mode by its flag', () => {
  assert.equal(pick('--breach-check').mode, 'breach');
  assert.equal(pick('--complaints').mode, 'complaints');
  assert.equal(pick('--confirm-emails').mode, 'confirm-emails');
  assert.equal(pick('--report').mode, 'report');
  assert.equal(pick('doctor').mode, 'doctor');
  assert.equal(pick('--update-brokers').mode, 'update-brokers');
  assert.equal(pick('--know').mode, 'know');
  assert.equal(pick('--reply', 'Pipl', 'honored').mode, 'reply');
  assert.equal(pick('--allow', 'Spokeo').mode, 'allowlist');
  assert.equal(pick('--encrypt-config').mode, 'encrypt-config');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/cli-flags.test.js test/watcher-mode-dispatch.test.js`
Expected: FAIL (modules/functions missing).

- [ ] **Step 3: Implement**

Create `lib/cli-flags.js`:

```js
'use strict';
/**
 * lib/cli-flags.js
 *
 * Every watcher.js flag, parsed once from argv. Names match the constants
 * watcher.js used, so the mode files read the same names.
 */
const { parseAllowlistArgs } = require('./allowlist-edit');

function valueAfter(argv, flag) {
  const i = argv.indexOf(flag);
  return i !== -1 ? (argv[i + 1] || '') : null;
}

function parseWatcherFlags(argv) {
  const has = (f) => argv.includes(f);
  const PREVIEW = has('--preview');
  // Phase 2: --email sends the email requests, --forms fills web forms. A plain
  // run is --forms only, so a scheduled run can never send email.
  const EMAIL = has('--email');
  const FREEZE_LIST = has('--freeze');
  const FREEZE_DONE_KEY = valueAfter(argv, '--freeze-done');
  const FREEZE_CLEAR_KEY = valueAfter(argv, '--freeze-clear');
  const confirmEmailsIdx = argv.indexOf('--confirm-emails');
  const CONFIRM_EMAILS = confirmEmailsIdx !== -1;
  // Optional dir argument: next argv element if it doesn't start with '--'
  const next = CONFIRM_EMAILS ? argv[confirmEmailsIdx + 1] : null;
  return {
    PREVIEW,
    EMAIL,
    FORMS: has('--forms') || !EMAIL,
    ASSIST: has('--assist'),
    DRY_RUN: has('--dry-run') || PREVIEW, // --preview implies --dry-run
    VERIFY: has('--verify'),
    SERP_SCAN: has('--serp-scan'),
    SERP_WATCH: has('--serp-watch'),
    DOCTOR: argv[2] === 'doctor' || has('--doctor'),
    ONLY_ARG: valueAfter(argv, '--only'),
    SKIP_ARG: valueAfter(argv, '--skip'),
    RETRY_FAILED: has('--retry-failed'),
    LIST_MODE: has('--list'),
    SCORE_MODE: has('--score'),
    PENDING_MODE: has('--pending'),
    UPDATE_BROKERS: has('--update-brokers'),
    BREACH_CHECK: has('--breach-check'),
    NO_CAPSOLVER: has('--no-capsolver'),
    RESUME: has('--resume'),
    SNAPSHOT: has('--snapshot'),
    REPORT: has('--report'),
    ENCRYPT_CONFIG: has('--encrypt-config'),
    DECRYPT_CONFIG: has('--decrypt-config'),
    KEEP_PLAINTEXT: has('--keep-plaintext'),
    KNOW_MODE: has('--know'),
    KNOW_STATUS: has('--know-status'),
    COMPLAINTS_MODE: has('--complaints'),
    FREEZE_LIST,
    FREEZE_DONE_KEY,
    FREEZE_CLEAR_KEY,
    FREEZE_MODE: FREEZE_LIST || FREEZE_DONE_KEY !== null || FREEZE_CLEAR_KEY !== null,
    CONFIRM_EMAILS,
    confirmEmailsDir: (next && !next.startsWith('--')) ? next : './inbox/confirms',
    REPLY: has('--reply'),
    ALLOWLIST_CMD: parseAllowlistArgs(argv),
  };
}

module.exports = { parseWatcherFlags };
```

Check `parseAllowlistArgs(argv)` returns `null` when neither `--allow` nor `--unallow` is present (read `lib/allowlist-edit.js`); if it returns `undefined`, normalise with `|| null` in the line above.

In `lib/mode-dispatch.js` add, and export next to `resolveMode`:

```js
// The order is the precedence watcher.js has always had. The read-only early
// modes run before the conflict check, exactly as before.
const EARLY_MODES = [
  ['freeze',         (f) => f.FREEZE_MODE],
  ['encrypt-config', (f) => f.ENCRYPT_CONFIG || f.DECRYPT_CONFIG],
  ['list',           (f) => f.LIST_MODE],
  ['reply',          (f) => f.REPLY],
  ['score',          (f) => f.SCORE_MODE],
  ['pending',        (f) => f.PENDING_MODE],
  ['allowlist',      (f) => !!f.ALLOWLIST_CMD],
  ['know-status',    (f) => f.KNOW_STATUS],
];
const LATE_MODES = [
  ['breach',         (f) => f.BREACH_CHECK],
  ['complaints',     (f) => f.COMPLAINTS_MODE],
  ['confirm-emails', (f) => f.CONFIRM_EMAILS],
  ['report',         (f) => f.REPORT],
  ['doctor',         (f) => f.DOCTOR],
  ['update-brokers', (f) => f.UPDATE_BROKERS],
  ['know',           (f) => f.KNOW_MODE],
];

/**
 * The one mode watcher.js runs for these flags (lib/cli-flags.js), or a
 * conflict message. No mode flag means the opt-out run.
 */
function pickMode(f) {
  for (const [mode, on] of EARLY_MODES) if (on(f)) return { mode, conflict: null };
  const { conflict } = resolveMode({
    list: f.LIST_MODE, score: f.SCORE_MODE, report: f.REPORT, doctor: f.DOCTOR,
    breachCheck: f.BREACH_CHECK, updateBrokers: f.UPDATE_BROKERS, pending: f.PENDING_MODE,
    know: f.KNOW_MODE, knowStatus: f.KNOW_STATUS, complaints: f.COMPLAINTS_MODE,
    confirmEmails: f.CONFIRM_EMAILS, serpScan: f.SERP_SCAN, serpWatch: f.SERP_WATCH,
    encryptConfig: f.ENCRYPT_CONFIG, decryptConfig: f.DECRYPT_CONFIG, freeze: f.FREEZE_MODE,
  });
  if (conflict) return { mode: null, conflict };
  for (const [mode, on] of LATE_MODES) if (on(f)) return { mode, conflict: null };
  return { mode: 'run', conflict: null };
}
```

(`module.exports = { resolveMode, pickMode };`). The `resolveMode({...})` mapping is the one in today's `watcher.js` mode-conflict guard; check it against that block and keep it identical.

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `npm test`.
Expected: PASS. (`watcher.js` does not use these yet.)

- [ ] **Step 5: Commit**

```bash
git add lib/cli-flags.js lib/mode-dispatch.js test/cli-flags.test.js test/watcher-mode-dispatch.test.js
git commit -m "feat: parseWatcherFlags and pickMode as pure, tested modules"
```

---

### Task 6: One file per mode; `watcher.js` becomes the entry point

This task moves code. Mode bodies move **verbatim**, with only the mechanical edits listed in Step 2. Do not improve, reflow or re-comment moved code.

**Files:**
- Create: `lib/modes/shared.js`, `lib/modes/{freeze,encrypt-config,list,reply,score,pending,allowlist,know-status,breach,complaints,confirm-emails,report,doctor,update-brokers,know,run}.js`, `test/helpers/watcher-source.js`, `test/modes-load.test.js`
- Rewrite: `watcher.js`
- Modify: the tests in Step 6's table

**Interfaces:**
- Consumes: `parseWatcherFlags`, `pickMode` (Task 5); `createBrokerRunner` (Task 4).
- Produces: every `lib/modes/<mode>.js` exports `run({ flags, argv }) -> Promise<number|undefined>|number|undefined`. `lib/modes/shared.js` exports `{ PREVIEW_ALIAS_NOTE, acquireStateLockOrExit, askLine, emailStepIo, loadRunSetup }`. `lib/modes/know.js` also exports `knowFlow`. `lib/modes/run.js` also exports `makeEgressCounter`, `EGRESS_RECHECK_EVERY`.

- [ ] **Step 1: Create `lib/modes/shared.js`**

```js
'use strict';
/**
 * lib/modes/shared.js
 *
 * Helpers more than one mode uses (moved from watcher.js).
 */
const { STATE_PATH, loadConfig, loadState, setDryRun, getPersonsFromConfig } = require('../config');
const lock = require('../lock');
const { PREVIEW_ALIAS } = require('../relay');
const { setEgressConfig, ensureNodeEgress } = require('../egress');
```

Then move from `watcher.js`, verbatim: the `// Printed once when a preview/dry-run person has no cached alias yet.` comment and `PREVIEW_ALIAS_NOTE` line; `acquireStateLockOrExit` with its comment; `askLine` with its comment; `emailStepIo` with its comment (change `require('./lib/email')` to `require('../email')`). Then add:

```js
// What the know and run modes share before they start: the dry-run switch,
// the config (also handed to the Node egress gate), the state and the persons.
function loadRunSetup(flags) {
  setDryRun(flags.DRY_RUN); // makes recordSuccess/saveState no-op-on-disk in dry-run
  const config = loadConfig();
  setEgressConfig(config);
  if (config.notify) console.log('Note: notify settings in config.json are ignored in this fork.');
  const state = loadState();
  const persons = getPersonsFromConfig(config);
  return { config, state, persons };
}

module.exports = { PREVIEW_ALIAS_NOTE, acquireStateLockOrExit, askLine, emailStepIo, loadRunSetup };
```

- [ ] **Step 2: Create one file per mode by moving its block**

The blocks, in `watcher.js` order. Each starts at its `if (...) {` line (with the comment header above it, which moves too) and ends at its matching closing brace:

| Mode file | Block in `watcher.js` | Flags the body reads |
|---|---|---|
| `freeze.js` | `if (FREEZE_MODE) {` | `FREEZE_DONE_KEY, FREEZE_CLEAR_KEY` |
| `encrypt-config.js` | `if (ENCRYPT_CONFIG \|\| DECRYPT_CONFIG) {` | `ENCRYPT_CONFIG, KEEP_PLAINTEXT` |
| `list.js` | `if (LIST_MODE) {` | none |
| `reply.js` | `if (process.argv.includes('--reply')) {` | none (uses `argv`) |
| `score.js` | `if (SCORE_MODE) {` | `DRY_RUN` |
| `pending.js` | `if (PENDING_MODE) {` | none |
| `allowlist.js` | `if (_allowlistCmd) {` | `ALLOWLIST_CMD` (add `const _allowlistCmd = flags.ALLOWLIST_CMD;`) |
| `know-status.js` | `if (KNOW_STATUS) {` | none |
| `breach.js` | `if (BREACH_CHECK) {` up to its `}` before `} else {` | none |
| `complaints.js` | `if (COMPLAINTS_MODE) {` | `DRY_RUN` |
| `confirm-emails.js` | `if (CONFIRM_EMAILS) {` | `DRY_RUN, confirmEmailsDir` |
| `report.js` | the body of `} else if (REPORT) {` | none |
| `doctor.js` | the body of `if (DOCTOR) {` | none |
| `update-brokers.js` | the body of `} else if (UPDATE_BROKERS) {` | none |
| `run.js` | from `brokerRunner.configure({ dryRun: DRY_RUN, preview: PREVIEW, assist: ASSIST, person: persons[0],` to the end of `main().catch(...)` (the trailing `} // end else ...` lines are dropped) | `DRY_RUN, PREVIEW, ASSIST, NO_CAPSOLVER, SNAPSHOT, EMAIL, FORMS, VERIFY, SERP_SCAN, SERP_WATCH, RETRY_FAILED, ONLY_ARG, SKIP_ARG, RESUME` |

`know.js` is not moved verbatim: Step 3 gives its full code.

Each file has this shape:

```js
'use strict';
/**
 * lib/modes/<mode>.js - <the block's header comment, first line> (moved from watcher.js).
 */
const path = require('path');   // only if the body uses path
const fs = require('fs');       // only if the body uses fs
const ROOT = path.join(__dirname, '..', '..'); // only if the body used __dirname
// The requires the body uses, taken from watcher.js's top-level requires,
// with './lib/X' written as '../X'.

async function run({ flags, argv }) {
  const { <the flags from the table> } = flags;
  <the block body, verbatim>
}

module.exports = { run };
```

Mechanical edits allowed inside a moved body, and nothing else:
1. `require('./lib/X')` becomes `require('../X')`; `require('./brokers')` becomes `require('../../brokers')`; `require('./generic-runner')` becomes `require('../../generic-runner')`.
2. `path.join(__dirname, ...)` becomes `path.join(ROOT, ...)`.
3. `process.argv` becomes `argv`.
4. A top-level `(async () => { ... })().then(...).catch(...)` or `promise.then(...).catch(...)` statement gets `return ` in front, so `run` returns it.
5. Uses of `acquireStateLockOrExit`, `askLine`, `emailStepIo`, `PREVIEW_ALIAS_NOTE` come from `require('./shared')`.

`run.js` additionally:
- Wraps the moved code as `async function run({ flags, argv }) { const { ...flags from the table } = flags; const { config, state, persons } = loadRunSetup(flags); <moved code> }` and replaces the final `main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });` with `return main();` (watcher.js prints the same `Fatal:` line and exits 1 on a rejection). `main` and `_mainBody` and their module-level helpers (`chromium`, `isMac`, `LOG_DIR`, `logFile`, `stamp`, `LOCK_PATH`, `mainSession`, `mainProfile`) stay inside `run` so they close over the flags.
- Deletes the first line of the moved code, `brokerRunner.configure({ dryRun: DRY_RUN, preview: PREVIEW, assist: ASSIST, person: persons[0], ... });` (dead: every person configures its own runner).
- In the per-person loop replaces `brokerRunner.configure({ dryRun: DRY_RUN, ... submissionEmail });` with `const runner = brokerRunner.createBrokerRunner({ dryRun: DRY_RUN, ... submissionEmail });` (same object), and `brokerRunner.appliesToPerson(broker, person)` / `brokerRunner.processBroker(context, broker)` with `runner.appliesToPerson(broker, person)` / `runner.processBroker(context, broker)`.
- Moves `const EGRESS_RECHECK_EVERY = 10;` (with its comment) to module level and adds below it:

```js
// Calls recheck before every Nth broker. One counter serves all persons, so a
// person boundary never resets the count.
function makeEgressCounter(recheck, every = EGRESS_RECHECK_EVERY) {
  let n = 0;
  return async () => {
    if (++n % every === 0) await recheck();
  };
}
```

  replaces `  // Counts brokers across persons, so a person boundary never skips a re-check.\n  let sinceCheck = 0;` with `  const beforeBroker = makeEgressCounter(() => session.recheckEgress());`, and `if (++sinceCheck % EGRESS_RECHECK_EVERY === 0) await session.recheckEgress();` with `await beforeBroker();`. Exports `{ run, makeEgressCounter, EGRESS_RECHECK_EVERY }`.

- [ ] **Step 3: Create `lib/modes/know.js`**

```js
'use strict';
/**
 * lib/modes/know.js - --know: right-to-know requests by email (moved from watcher.js).
 */
const { STATE_PATH, saveState, getPendingKnowRequests } = require('../config');
const lock = require('../lock');
const { EgressError } = require('../egress');
const { buildSubmissionPlan, submissionOptions } = require('../submission-plan');
const { checkEmailSetup } = require('../email-step');
const { runKnowStep } = require('../right-to-know-runner');
const { PREVIEW_ALIAS_NOTE, acquireStateLockOrExit, emailStepIo, loadRunSetup } = require('./shared');

// The --know flow after setup. deps are injectable so the order of the checks
// can be tested without a mailbox, SimpleLogin or a terminal.
async function knowFlow({ config, persons, state, brokers, preview }, deps = {}) {
  const d = {
    checkEmailSetup, buildSubmissionPlan, runKnowStep, saveState, getPendingKnowRequests,
    io: emailStepIo,
    isTTY: () => !!process.stdin.isTTY,
    log: (l) => console.log(l),
    error: (l) => console.error(l),
    ...deps,
  };
  // Check the mailbox setup first: a run that will be refused must not
  // create a SimpleLogin alias.
  const setupProblem = d.checkEmailSetup({ config, persons, isTTY: d.isTTY(), preview });
  if (setupProblem) {
    d.log(`Right-to-know not sent: ${setupProblem}.`);
    return 1;
  }
  const plan = await d.buildSubmissionPlan({ config, persons, state, preview });
  for (const b of plan.blocked) {
    d.error(`Skipping person #${persons.indexOf(b.person) + 1}: ${b.reason}`);
  }
  if (plan.allowed.some(a => a.placeholder)) d.log(PREVIEW_ALIAS_NOTE);
  const code = await d.runKnowStep({
    config, persons, state, save: d.saveState, brokers, preview,
    ...submissionOptions(plan), ...d.io(),
  });
  // Keeps an alias minted by buildSubmissionPlan even when nothing was sent.
  d.saveState();
  const pending = d.getPendingKnowRequests(brokers, { olderThanDays: 45 });
  d.log(`\n${pending.length} earlier request(s) are past 45 days (run --know-status for detail).\n`);
  return code;
}

async function run({ flags }) {
  const { config, state, persons } = loadRunSetup(flags);
  const brokers = require('../../brokers');
  const KNOW_LOCK_PATH = STATE_PATH + '.lock';
  acquireStateLockOrExit();
  try {
    const code = await knowFlow({ config, persons, state, brokers, preview: flags.DRY_RUN });
    lock.release(KNOW_LOCK_PATH);
    return code;
  } catch (err) {
    // Keep an alias minted before the throw.
    try { saveState(); } catch (saveErr) { console.error('could not save state:', saveErr.message); }
    lock.release(KNOW_LOCK_PATH);
    if (err instanceof EgressError) console.error(err.message);
    else console.error('know error:', err.message);
    return 1;
  }
}

module.exports = { run, knowFlow };
```

Compare it with the `if (KNOW_MODE) {` block in `watcher.js` before deleting that block: every statement there must have its counterpart here.

- [ ] **Step 4: Rewrite `watcher.js`**

```js
#!/usr/bin/env node
/**
 * upec-wipe - watcher.js (entry point)
 *
 * Refuses what this fork never runs, parses the flags, picks one mode and runs
 * it from lib/modes/ (one file per mode; lib/modes/run.js is the opt-out run).
 * Run: node watcher.js   (add --dry-run to fill forms without submitting)
 */

// Audit M2: everything this process creates (run logs, audit files, snapshots,
// complaints, reports, config rewrites) is owner-only, however it was launched.
process.umask(0o077);

const { parseWatcherFlags } = require('./lib/cli-flags');
const { pickMode } = require('./lib/mode-dispatch');
const { resolveHeadless } = require('./lib/browser');
require('./lib/privilege').exitIfRoot();
```

followed, verbatim from the old file, by the `--pollute` refusal block and the `--install-scheduler` refusal block (with their comments), then:

```js
const flags = parseWatcherFlags(process.argv);
if (flags.EMAIL && flags.VERIFY) {
  console.error('--email cannot be combined with --verify.');
  process.exit(1);
}
// --assist: pause on bot-protection checks so the member can clear them in the
// browser window (lib/assist.js). Needs a visible window; refuse before any work.
if (flags.ASSIST && resolveHeadless()) {
  console.error('--assist needs a visible browser window (a desktop session, not HEADLESS=1 or a display-less server).');
  process.exit(1);
}

const picked = pickMode(flags);
if (picked.conflict) {
  console.error(`Error: ${picked.conflict}`);
  process.exit(1);
}

// A mode returns an exit code, or nothing to let the process end on its own
// (the opt-out run sets process.exitCode instead of exiting).
Promise.resolve()
  .then(() => require(`./lib/modes/${picked.mode}`).run({ flags, argv: process.argv }))
  .then((code) => { if (typeof code === 'number') process.exit(code); })
  .catch((err) => {
    console.error('\nFatal:', err.message);
    process.exit(1);
  });
```

- [ ] **Step 5: Add the source helper and the load test**

Create `test/helpers/watcher-source.js`:

```js
'use strict';
// watcher.js and its mode files, for tests that pin wiring by source text.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MODES = path.join(ROOT, 'lib', 'modes');

function modeFiles() {
  return fs.readdirSync(MODES).filter(f => f.endsWith('.js')).sort().map(f => path.join('lib', 'modes', f));
}
function modeSource(name) {
  return fs.readFileSync(path.join(MODES, `${name}.js`), 'utf8');
}
function watcherSource() {
  return ['watcher.js', ...modeFiles()].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
}

module.exports = { watcherSource, modeSource, modeFiles };
```

Create `test/modes-load.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MODES = ['freeze', 'encrypt-config', 'list', 'reply', 'score', 'pending', 'allowlist', 'know-status',
  'breach', 'complaints', 'confirm-emails', 'report', 'doctor', 'update-brokers', 'know', 'run'];

test('every mode pickMode can return has a file with run()', () => {
  for (const m of MODES) {
    const mod = require(`../lib/modes/${m}`);
    assert.equal(typeof mod.run, 'function', m);
  }
});

test('watcher.js is a short entry point', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');
  assert.ok(src.split('\n').length < 90, `watcher.js has ${src.split('\n').length} lines`);
  assert.match(src, /pickMode\(flags\)/);
});

test('the opt-out run does not call process.exit at its end', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'modes', 'run.js'), 'utf8');
  assert.match(src, /return main\(\);/);
});
```

- [ ] **Step 6: Repoint the source tests**

Run `npm test` and fix each failure from this table. Use `watcherSource()` / `modeSource(name)` from `test/helpers/watcher-source.js`; keep each assertion's meaning.

| Test file | Change |
|---|---|
| `broker-runner-usonly.test.js` (reads watcher.js) | read `modeSource('run')`; in the regex `brokerRunner\.appliesToPerson` becomes `runner\.appliesToPerson` |
| `browser-launch.test.js` | `watcher` = `watcherSource()` |
| `captcha-egress.test.js` | `modeSource('run')` |
| `catalog-runner.test.js` | `watcherSource()` |
| `dry-run-footer.test.js` | `modeSource('run')` |
| `hibp-confirm.test.js` (watcher test) | `modeSource('breach')` |
| `no-notifications.test.js` | add `...modeFiles()` to `SOURCES` |
| `playwright-loader.test.js` | add `...modeFiles()` to the file list |
| `pollute-disabled.test.js` "no runnable noise branch" | `watcherSource()` |
| `preview-no-side-effects.test.js` | `modeSource('run')` |
| `shutdown.test.js` | handler count: `watcherSource()`; `--confirm-emails` order: `modeSource('confirm-emails')` |
| `umask-file-modes.test.js` mkdirSync list | add `'lib/modes/run.js', 'lib/modes/report.js', 'lib/modes/complaints.js'` |
| `watcher-assist-flag.test.js` | `modeSource('run')`; regex `brokerRunner\.configure\(\{[^}]*\}\)` becomes `createBrokerRunner\(\{[^}]*\}\)` |
| `watcher-email-flags.test.js` | delete the two `const EMAIL`/`const FORMS` regex asserts (Task 5's `cli-flags.test.js` covers them); `runEmailStep`, `if (EMAIL) {`, `if (!FORMS) return;`, `sendOptOutEmails`: `modeSource('run')`; `ensureEgress: (cfg) => ensureNodeEgress(cfg, { fresh: true })`: `modeSource('shared')`; `emailStatus(state, n)`: `modeSource('list')` |
| `node-egress.test.js` "wires the gate config once" | `watcherSource()` |
| `watcher-egress-wiring.test.js` | `src` = `watcherSource()`; the generic-pass block test reads `modeSource('run')`; the `let sinceCheck = 0;` test is replaced in Task 7 (here: skip it with `test.skip` and the reason "replaced by Task 7") |
| `watcher-know-step.test.js` | `src` = `watcherSource()`; `sendKnowRequests` absent: unchanged; the `...emailStepIo()` count becomes: `modeSource('run')` contains `...emailStepIo()` once and `modeSource('know')` contains `io: emailStepIo`; the transport assert reads `modeSource('shared')`; the `saveState()` placement test reads `modeSource('know')` and checks `saveState()` sits between `await d.runKnowStep(` and `getPendingKnowRequests(`; the `.catch` test checks `modeSource('know')` matches `/catch \(err\) \{[\s\S]*saveState\(\)/`; the setup-before-alias test is replaced in Task 7 (here: `test.skip` with the reason "replaced by Task 7") |
| `watcher-state-lock.test.js` | `--list`: `modeSource('list')` has one `loadCatalog(`; reply: `modeSource('reply')` has `acquireStateLockOrExit()` and `resetState()`; "Another instance is running" once in `watcherSource()` |
| `watcher-serp-history.test.js` | `watcherSource()` |

A spawn test (`freeze-cli`, `watcher-encrypt-cli`, `umask-file-modes`, `pollute-disabled`, `manual-only`, `watcher-assist-flag`, `cli-*`) that fails is a behaviour regression in the move: fix the mode file, not the test.

- [ ] **Step 7: Run everything**

Run: `npm test`, `node --test dashboard/*.test.js`, and `node watcher.js --pollute 1; echo $?` (expect the disabled line and 1).
Expected: PASS, and `wc -l watcher.js` under 90.

- [ ] **Step 8: Commit**

```bash
git add watcher.js lib/modes test/
git commit -m "refactor(watcher): one file per mode under lib/modes; watcher.js is the entry point"
```

---

### Task 7: Behaviour tests for the two wiring checks

**Files:**
- Test: create `test/modes-know-run.test.js`; remove the two `test.skip` entries left by Task 6

**Interfaces:**
- Consumes: `knowFlow` (`lib/modes/know.js`), `makeEgressCounter` (`lib/modes/run.js`).

- [ ] **Step 1: Write the tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { knowFlow } = require('../lib/modes/know');
const { makeEgressCounter } = require('../lib/modes/run');
const { modeSource } = require('./helpers/watcher-source');

const P = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Austin', state: 'TX', email: 'jane.doe@example.com' };

test('know: a refused setup never reaches SimpleLogin', async () => {
  let planned = 0;
  const lines = [];
  const code = await knowFlow({ config: {}, persons: [P], state: {}, brokers: [], preview: false }, {
    checkEmailSetup: () => 'add an email.smtp block',
    buildSubmissionPlan: async () => { planned++; return { allowed: [], blocked: [] }; },
    log: (l) => lines.push(l), isTTY: () => true,
  });
  assert.equal(code, 1);
  assert.equal(planned, 0);
  assert.match(lines.join('\n'), /Right-to-know not sent: add an email\.smtp block/);
});

test('know: a good setup checks, plans, sends, then saves, in that order', async () => {
  const order = [];
  const code = await knowFlow({ config: {}, persons: [P], state: {}, brokers: [], preview: false }, {
    checkEmailSetup: () => { order.push('check'); return null; },
    buildSubmissionPlan: async () => { order.push('plan'); return { allowed: [], blocked: [] }; },
    runKnowStep: async () => { order.push('send'); return 0; },
    saveState: () => { order.push('save'); },
    getPendingKnowRequests: () => [],
    io: () => ({}), log: () => {}, isTTY: () => true,
  });
  assert.equal(code, 0);
  assert.deepEqual(order, ['check', 'plan', 'send', 'save']);
});

test('run: the egress counter re-checks every 10th broker across persons', async () => {
  let checks = 0;
  const before = makeEgressCounter(async () => { checks++; }, 10);
  for (let i = 0; i < 7; i++) await before();   // person 1
  for (let i = 0; i < 14; i++) await before();  // person 2
  assert.equal(checks, 2);                      // brokers 10 and 20 overall
});

test('run: one counter is made before the persons loop', () => {
  const src = modeSource('run');
  const made = src.indexOf('const beforeBroker = makeEgressCounter(');
  assert.ok(made > 0);
  assert.ok(made < src.indexOf('for (const { person, email: submissionEmail, masked } of plan.allowed)'));
});
```

- [ ] **Step 2: Run them**

Run: `node --require ./test/helpers/egress-off.js --test test/modes-know-run.test.js`
Expected: PASS (they pin Task 6's code). Then check they can fail: temporarily swap the `checkEmailSetup` and `buildSubmissionPlan` calls in `knowFlow` and confirm the first two tests fail; restore.

- [ ] **Step 3: Remove the skips**

Delete the two `test.skip` entries Task 6 left in `test/watcher-egress-wiring.test.js` and `test/watcher-know-step.test.js`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS, with no skipped tests from these files.

- [ ] **Step 5: Commit**

```bash
git add test/modes-know-run.test.js test/watcher-egress-wiring.test.js test/watcher-know-step.test.js
git commit -m "test: behaviour tests for the know check order and the egress counter"
```
