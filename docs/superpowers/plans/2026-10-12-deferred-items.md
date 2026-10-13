# Plan C: Deferred Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every item the overhaul, Plan A and Plan B reviews deferred.

**Architecture:** Six small, local tasks on the same branch as Plan B. Each behaviour change is test-first; the coverage-only tests pin existing behaviour.

**Tech Stack:** Node.js 20+ (CommonJS), `node:test`.

**Spec:** this plan's own item list below (the deferred lines of the three reviews). There is no separate spec document; the parent specs are `docs/superpowers/specs/2026-10-12-watcher-restructure-design.md` and `2026-10-12-perf-followups-design.md`.

## Items and where they land

| Deferred item | Task |
|---|---|
| `.bak` sharing checked by inode only (unreliable on drvfs) | 1 |
| Detached `.bak` copy not fsynced | 1 |
| A save that cannot run safely fails with a bare EPERM message | 1 |
| Test message overstates what `writeFileCalls` proves | 1 |
| The breach prompt hangs when stdin is closed | 2 |
| The breach order is pinned only by a source-text test | 2 |
| `reply --right-to-know` only works after `<broker> <outcome>` | 3 |
| No tests for bounced-unknown and twice-failed email ordering | 3 |
| Errors print `Fatal: <message>` with no way to see the stack | 4 |
| The generic pass swallows click errors silently | 4 |
| No test for the checkbox-reveal wait in `fillForm` | 5 |
| Runner isolation test does not cover `configure()` state | 5 |
| More `pickMode` precedence tests; exact conflict text | 5 |
| Per-person counter pinned only by source position | 5 |
| `modes-load` list is hard-coded | 5 |
| umask `mkdirSync` test lists mode files by hand | 5 |
| Header comments in `complaints.js` / `update-brokers.js`; `runBroker` JSDoc title | 6 |
| Stale `.bak.tmp` before `copyFileSync` | already fixed in Plan B (Task 1 fix round) |
| `between()` -1 guard in `watcher-state-lock` | gone: Plan B Task 6 removed `between()` |

## Global Constraints

- Branch: `upec/watcher-restructure` (Plan B's branch, head 07207a6). Never push; never force-push.
- Read `CLAUDE.md` first. Never run `setup.js`, `upec-wipe run`, `--email`, `--know`, `--breach-check` or `preview` against the real config. Never read, print, copy or commit `config.json`, `config.json.enc`, `state.json`, `logs/`, `secrets/`.
- Tests use the dummy person (Jane Doe, Austin TX, `jane.doe@example.com`). No real personal data anywhere.
- Plain hyphens only: no em dash (U+2014) or en dash (U+2013) in tracked files. No emoji in non-test JS.
- Full suite: `npm test`. Dashboard tests: `node --test dashboard/*.test.js`. Single file: `node --require ./test/helpers/egress-off.js --test test/<file>.test.js`.
- Commit messages end with a `Co-Authored-By:` trailer naming the model that wrote the commit.

## Review Focus

- `UPEC_WIPE_DEBUG` output must never contain personal data: stacks are file paths, and click errors are passed through `redactUrlsInText`. Pinned in Task 4.
- A refused breach confirmation must never reach `runBreachCheck`, including when stdin is closed. Pinned in Task 2.
- The `.bak` must be detached whenever it might share the state file's inode, even where inode numbers lie. Pinned in Task 1.

---

### Task 1: State-file hardening

**Files:** Modify `lib/config.js` (`_renameOrRewrite`, `_detachBak`); Test `test/config-reliability.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/config-reliability.test.js`, following the file's existing pattern (`cfg.setTestStatePath`, temp dir, restore in `finally`):

```js
test('saveState: a locked save explains itself and says nothing was lost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-locked-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realRename = fs.renameSync;
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__a__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    cfg.saveState();
    fs.renameSync = (from, to) => {
      if (to === statePath || to === bakPath) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; }
      return realRename(from, to);
    };
    cfg.loadState().optOuts.__b__ = { lastSuccess: '2026-01-02T00:00:00.000Z' };
    assert.throws(() => cfg.saveState(), (e) => /could not be saved safely/.test(e.message) && /Nothing was lost/.test(e.message) && e.code === 'EPERM');
  } finally {
    fs.renameSync = realRename;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveState: a link count above one detaches the .bak even when inode numbers disagree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-nlink-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realRename = fs.renameSync;
  const realStat = fs.statSync;
  const realOpen = fs.openSync;
  const realWriteFileSync = fs.writeFileSync;
  const opened = [];
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__a__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    cfg.saveState(); // linked .bak
    const linkedIno = realStat(statePath).ino;
    // drvfs-style lie: the .bak reports a different inode number.
    fs.statSync = (p, o) => {
      const s = realStat(p, o);
      if (p === bakPath) return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { ino: s.ino + 1 });
      return s;
    };
    fs.openSync = (p, flags, ...rest) => { opened.push([p, flags]); return realOpen(p, flags, ...rest); };
    let bakInoDuringRewrite = null;
    fs.writeFileSync = (p, ...rest) => {
      if (p === statePath) bakInoDuringRewrite = realStat(bakPath).ino;
      return realWriteFileSync(p, ...rest);
    };
    fs.renameSync = (from, to) => {
      if (to === statePath) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; }
      return realRename(from, to);
    };
    cfg.loadState().optOuts.__b__ = { lastSuccess: '2026-01-02T00:00:00.000Z' };
    cfg.saveState();
    assert.notEqual(bakInoDuringRewrite, null, 'the in-place fallback ran');
    assert.notEqual(bakInoDuringRewrite, linkedIno, 'the .bak was detached before the in-place write');
    assert.ok(opened.some(([p, f]) => p === bakPath + '.tmp' && f === 'r+'), 'the detached copy was opened for fsync');
  } finally {
    fs.renameSync = realRename;
    fs.statSync = realStat;
    fs.openSync = realOpen;
    fs.writeFileSync = realWriteFileSync;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

The second test records the .bak's real inode at the moment state.json is written in place: with the inode-only check, the lying stat makes the code skip the detach, so the .bak still shares the inode then.

In the existing test `saveState: the .bak is a hard link to the saved file, not a second write`, change the message of `assert.equal(writeFileCalls, 0, ...)` to `'the .bak was written with writeFileSync instead of being linked'`.

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/config-reliability.test.js`
Expected: FAIL on both new tests (bare `EPERM` message; inode-only check sees "not shared" and writes through the link).

- [ ] **Step 3: Implement**

In `_renameOrRewrite`, replace

```js
    if (typeof beforeRewrite === 'function' && beforeRewrite() === false) throw err;
```

(or the equivalent line Plan B wrote) with

```js
    if (typeof beforeRewrite === 'function' && beforeRewrite() === false) {
      const locked = new Error(`${path.basename(target)} could not be saved safely: another program is holding it (${err.code}). Nothing was lost; close that program and run again.`);
      locked.code = err.code;
      locked.cause = err;
      throw locked;
    }
```

Replace `_detachBak` with:

```js
// A .bak that is a hard link of `target` shares its inode. Before anything
// writes `target` in place, give the .bak its own copy of the old state, or an
// interrupted write would truncate both. Returns false only when they share
// and the copy could not be made; the caller must then not write in place.
function _detachBak(target, bak) {
  let shared;
  try {
    const t = fs.statSync(target);
    const b = fs.statSync(bak);
    // The link count catches sharing even where inode numbers are unreliable
    // (drvfs, network shares); the dev+ino pair catches it everywhere else.
    shared = t.nlink > 1 || (t.ino === b.ino && t.dev === b.dev);
  } catch (_) {
    return true; // No .bak or no target yet: nothing shares an inode.
  }
  if (!shared) return true;
  const bakTmp = bak + '.tmp';
  try {
    try { fs.unlinkSync(bakTmp); } catch (_) {}
    fs.copyFileSync(target, bakTmp);
    // During the in-place write this copy is the only intact old state.
    const fd = fs.openSync(bakTmp, 'r+');
    try { fs.fsyncSync(fd); } catch (_) {} finally { fs.closeSync(fd); }
    fs.renameSync(bakTmp, bak);
    return true;
  } catch (_) {
    try { fs.unlinkSync(bakTmp); } catch (__) {}
    return false;
  }
}
```

Make sure `path` is required at the top of `lib/config.js` (it is used elsewhere in the file; check).

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/config-reliability.test.js test/config-atomic-write.test.js test/config-bindmount-write.test.js test/config.test.js test/file-permissions.test.js`, then `npm test`. If an existing test asserted `/EPERM/` on the thrown message, it still passes (the message contains the code).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/config.js test/config-reliability.test.js
git commit -m "fix(state): detach the .bak by link count, fsync the copy, explain a locked save"
```

---

### Task 2: The breach prompt cannot hang, and its order is a behaviour test

**Files:** Modify `lib/modes/shared.js` (`askLine`), `lib/modes/breach.js`; Test create `test/breach-mode.test.js`; modify `test/hibp-confirm.test.js` (remove the source-order test)

**Interfaces:** Produces `askLine(question, { input, output }?) -> Promise<string>` (resolves `''` when input ends); `breachFlow({ emails, apiKey, brokers, config }, deps?) -> Promise<0|1>` exported from `lib/modes/breach.js`.

- [ ] **Step 1: Write the failing tests**

Create `test/breach-mode.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const { askLine } = require('../lib/modes/shared');
const { breachFlow } = require('../lib/modes/breach');

const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

test('askLine resolves with the typed line', async () => {
  assert.equal(await askLine('Q? ', { input: Readable.from(['YES\n']), output: sink() }), 'YES');
});

test('askLine resolves empty when input is closed, instead of hanging', async () => {
  assert.equal(await askLine('Q? ', { input: Readable.from([]), output: sink() }), '');
});

test('breach: a refused confirmation never reaches HIBP', async () => {
  let checked = 0;
  const code = await breachFlow({ emails: ['jane.doe@example.com'], apiKey: 'k', brokers: [], config: {} }, {
    confirmBreachCheck: async () => false,
    runBreachCheck: async () => { checked++; return {}; },
    log: () => {},
  });
  assert.equal(code, 1);
  assert.equal(checked, 0);
});

test('breach: a confirmed check runs and returns 0', async () => {
  const order = [];
  const code = await breachFlow({ emails: ['jane.doe@example.com'], apiKey: 'k', brokers: [], config: {} }, {
    confirmBreachCheck: async () => { order.push('confirm'); return true; },
    runBreachCheck: async () => { order.push('check'); return {}; },
    formatBreachReport: () => 'report',
    log: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(order, ['confirm', 'check']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/breach-mode.test.js`
Expected: FAIL (`breachFlow` undefined; the closed-input `askLine` never resolves, so that test times out or fails).

- [ ] **Step 3: Implement**

In `lib/modes/shared.js` replace `askLine` with:

```js
// One line of input from the terminal. Resolves '' when input ends (a closed
// stdin), so a prompt can never hang the process.
function askLine(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input, output });
    let answered = false;
    rl.question(question, a => { answered = true; rl.close(); resolve(a); });
    rl.on('close', () => { if (!answered) resolve(''); });
  });
}
```

In `lib/modes/breach.js`: move the `require('../hibp')` destructuring to the top of the file, add before `run`:

```js
// The part after the setup checks. deps are injectable so the order (ask,
// then check) can be tested without HIBP or a terminal.
async function breachFlow({ emails, apiKey, brokers, config }, deps = {}) {
  const d = {
    confirmBreachCheck, runBreachCheck, formatBreachReport,
    ask: askLine,
    isTTY: () => !!process.stdin.isTTY,
    log: (l) => console.log(l),
    ...deps,
  };
  const ok = await d.confirmBreachCheck({ emails, isTTY: d.isTTY(), ask: d.ask, log: d.log });
  if (!ok) return 1;
  d.log(`\nChecking ${emails.length} email(s) against Have I Been Pwned...`);
  const result = await d.runBreachCheck({ emails, apiKey, brokers, config });
  d.log('\n' + d.formatBreachReport(result) + '\n');
  return 0;
}
```

and replace the `return (async () => { ... })().catch(...)` statement at the end of `run` with:

```js
  try {
    return await breachFlow({ emails, apiKey, brokers, config: cfg });
  } catch (err) {
    console.error('breach-check error:', err.message);
    return 1;
  }
```

Export `{ run, breachFlow }`. (watcher.js exits with the returned code, so exit codes stay 0 and 1.)

In `test/hibp-confirm.test.js` delete the test `watcher asks before running the breach check` (the source-order check); `test/breach-mode.test.js` now covers it by behaviour. Remove any imports that become unused.

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/breach-mode.test.js test/hibp-confirm.test.js test/hibp.test.js test/modes-load.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/modes/shared.js lib/modes/breach.js test/breach-mode.test.js test/hibp-confirm.test.js
git commit -m "fix(breach): a closed stdin refuses instead of hanging; test the ask-then-check order"
```

---

### Task 3: `reply` flag order, and email ordering tests

**Files:** Modify `lib/modes/reply.js`; Test `test/reply-right-to-know.test.js`, `test/email-run-step.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/reply-right-to-know.test.js`:

```js
test('reply --right-to-know works wherever the flag sits', () => {
  const { r, state } = runReply(['--right-to-know', 'Pipl', 'bounced'], {
    optOuts: {}, emailSent: { 'know:Pipl': { to: 'privacy@pipl.com', at: 't', messageId: 'm' } },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(state.emailReplies['know:Pipl'].outcome, 'bounced');
});
```

Append to `test/email-run-step.test.js`:

```js
test('a bounced interrupted send goes to manual without a resend prompt', async () => {
  const state = { optOuts: {}, emailSent: { Alpha: { to: 'p@alpha.com', at: 't', status: 'unknown' } }, emailReplies: { Alpha: { outcome: 'bounced', at: 't' } } };
  const { d, out } = deps({ state, ask: async (q) => { if (/Resend/.test(q)) throw new Error('must not ask'); return 'SEND'; } });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 0);
  assert.match(out.lines.join('\n'), /manual Alpha/);
});

test('an address that failed twice goes to manual', async () => {
  const state = { optOuts: {}, emailFailures: { Alpha: 2 } };
  const { d, out } = deps({ state });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 0);
  assert.match(out.lines.join('\n'), /manual Alpha/);
});
```

- [ ] **Step 2: Run them**

Run: `node --require ./test/helpers/egress-off.js --test test/reply-right-to-know.test.js test/email-run-step.test.js`
Expected: the reply test FAILS (`--right-to-know` is read as the broker name); the two email tests pass (they pin Plan B's ordering).

- [ ] **Step 3: Implement**

In `lib/modes/reply.js` replace

```js
  const query = argv[i + 1] || '';
  const outcome = argv[i + 2] || '';
```

with

```js
  // The values after --reply, skipping flags, so --right-to-know can sit anywhere.
  const [query = '', outcome = ''] = argv.slice(i + 1).filter(a => !a.startsWith('--'));
```

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/modes/reply.js test/reply-right-to-know.test.js test/email-run-step.test.js
git commit -m "fix(reply): accept --right-to-know anywhere; pin bounced-unknown and twice-failed ordering"
```

---

### Task 4: `UPEC_WIPE_DEBUG` for fatal stacks and generic click failures

**Files:** Modify `lib/modes/shared.js` (add `formatFatal`), `watcher.js` (catch), `generic-runner.js` (`dismissBanners`, `clickDoNotSell`), `docs/UPEC-MANUAL.md` (troubleshooting rows); Test create `test/debug-output.test.js`

**Interfaces:** Produces `formatFatal(err, env?) -> string` (exported from `lib/modes/shared.js`).

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatFatal } = require('../lib/modes/shared');
const { _clickDoNotSell } = require('../generic-runner');

test('a fatal error prints one line, plus the stack only with UPEC_WIPE_DEBUG', () => {
  const err = new Error('boom');
  assert.equal(formatFatal(err, {}), '\nFatal: boom');
  const dbg = formatFatal(err, { UPEC_WIPE_DEBUG: '1' });
  assert.ok(dbg.startsWith('\nFatal: boom\n'));
  assert.match(dbg, /at /);
});

test('a failed generic click is shown under UPEC_WIPE_DEBUG, with URLs redacted', async () => {
  const el = { first: () => el, count: async () => 1, click: async () => { throw new Error('click failed at https://broker.example/opt-out?first=Jane'); } };
  const page = { locator: () => el, waitForTimeout: async () => {} };
  const warned = [];
  const realWarn = console.warn;
  const had = process.env.UPEC_WIPE_DEBUG;
  console.warn = (...a) => warned.push(a.join(' '));
  process.env.UPEC_WIPE_DEBUG = '1';
  try {
    assert.equal(await _clickDoNotSell(page), false);
  } finally {
    console.warn = realWarn;
    if (had === undefined) delete process.env.UPEC_WIPE_DEBUG; else process.env.UPEC_WIPE_DEBUG = had;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0], /\[generic\] Do Not Sell click failed/);
  assert.ok(!warned[0].includes('Jane'), 'no personal data in the debug line');
});

test('without UPEC_WIPE_DEBUG a failed click stays quiet', async () => {
  const el = { first: () => el, count: async () => 1, click: async () => { throw new Error('x'); } };
  const page = { locator: () => el, waitForTimeout: async () => {} };
  const warned = [];
  const realWarn = console.warn;
  const had = process.env.UPEC_WIPE_DEBUG;
  console.warn = (...a) => warned.push(a.join(' '));
  delete process.env.UPEC_WIPE_DEBUG;
  try {
    await _clickDoNotSell(page);
  } finally {
    console.warn = realWarn;
    if (had !== undefined) process.env.UPEC_WIPE_DEBUG = had;
  }
  assert.equal(warned.length, 0);
});
```

Before relying on the redaction assert, read `lib/redact.js` `redactUrlsInText`: if it replaces whole URLs, `Jane` (inside the query string) disappears with the URL. If it does not, stop and report.

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/debug-output.test.js`
Expected: FAIL (`formatFatal` undefined; no warning).

- [ ] **Step 3: Implement**

`lib/modes/shared.js`, add and export:

```js
// The line watcher.js prints when a mode ends in an error. UPEC_WIPE_DEBUG adds
// the stack (file paths and line numbers only).
function formatFatal(err, env = process.env) {
  const line = `\nFatal: ${err && err.message}`;
  return env.UPEC_WIPE_DEBUG && err && err.stack ? `${line}\n${err.stack}` : line;
}
```

`watcher.js` catch: replace `console.error('\nFatal:', err.message);` with `console.error(require('./lib/modes/shared').formatFatal(err));`.

`generic-runner.js`: add near the top `const { redactUrlsInText } = require('./lib/redact');` (if `redactUrlsInText` is already required at top level, reuse it), and above `dismissBanners`:

```js
// A failed click is not an error for the pass (the page may simply differ), but
// UPEC_WIPE_DEBUG shows it, with URLs removed.
function debugClickFailure(what, err) {
  if (!process.env.UPEC_WIPE_DEBUG) return;
  console.warn(`[generic] ${what} click failed: ${redactUrlsInText(String((err && err.message) || err)).slice(0, 120)}`);
}
```

In `dismissBanners` change `} catch (_) {}` to `} catch (err) { debugClickFailure('cookie banner', err); }`; in `clickDoNotSell` change it to `} catch (err) { debugClickFailure('Do Not Sell', err); }`.

`docs/UPEC-MANUAL.md` troubleshooting table: add two rows after the `Network check failed` row:

```
| `state.json could not be saved safely: another program is holding it ...` | Close the program that has the file open (an editor, a sync or backup tool, antivirus scanning it) and run again. Nothing was lost. |
| `Fatal: <message>` | Run the same command with `UPEC_WIPE_DEBUG=1` in front to also print where it failed (file and line only), and include that when you ask for help. |
```

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/debug-output.test.js test/generic-selectors.test.js test/generic-runner-*.test.js test/upec-docs.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/modes/shared.js watcher.js generic-runner.js docs/UPEC-MANUAL.md test/debug-output.test.js
git commit -m "feat: UPEC_WIPE_DEBUG prints fatal stacks and generic click failures (URLs redacted)"
```

---

### Task 5: Test coverage

No production behaviour changes except one new export (`MODE_NAMES`). The new tests pin existing behaviour; for each, name in the report the change that would make it fail.

**Files:** `lib/mode-dispatch.js` (export `MODE_NAMES`); tests `test/forms-fill-report.test.js`, `test/broker-runner-instances.test.js`, `test/watcher-mode-dispatch.test.js`, `test/modes-know-run.test.js`, `test/modes-load.test.js`, `test/umask-file-modes.test.js`

- [ ] **Step 1: Add the tests and the export**

`lib/mode-dispatch.js`: add and export `const MODE_NAMES = [...EARLY_MODES, ...LATE_MODES].map(([name]) => name).concat('run');`.

`test/modes-load.test.js`: replace the hard-coded `const MODES = [...]` with `const { MODE_NAMES: MODES } = require('../lib/mode-dispatch');`.

`test/umask-file-modes.test.js` mkdirSync list: replace `'lib/modes/run.js', 'lib/modes/report.js', 'lib/modes/complaints.js'` with `...require('./helpers/watcher-source').modeFiles()`.

Append to `test/forms-fill-report.test.js`:

```js
test('a field revealed by a ticked box is waited for, then filled', async () => {
  let revealed = false;
  let waited = 0;
  const box = { first: () => box, isVisible: async () => true, evaluate: async (fn) => fn({ tagName: 'INPUT', type: 'checkbox' }), check: async () => { revealed = true; } };
  const later = { first: () => later, isVisible: async () => revealed && waited > 0, waitFor: async () => { waited++; }, evaluate: async (fn) => fn({ tagName: 'INPUT', type: 'text' }), fill: async () => {} };
  const page = { locator: (sel) => (sel.includes('consent') ? box : later) };
  const r = await fillForm(page, { 'input[name="consent"]': 'on', 'input[name="firstName"]': 'Jane' });
  assert.equal(waited, 1);
  assert.deepEqual(r.filled.map(f => f.kind), ['checkbox', 'text']);
});
```

Append to `test/broker-runner-instances.test.js`:

```js
test('a created runner ignores the default runner configure() state', async () => {
  const br = require('../lib/broker-runner');
  config.setDryRun(true);
  try {
    br.configure({ config: { allowlist: ['Acme'] } });
    const fresh = createBrokerRunner({ config: { allowlist: [] }, person: { firstName: 'Jane', lastName: 'Doe' } });
    const manualBefore = results.manual.length;
    await fresh.processBroker({}, { name: 'Acme', method: 'manual', notes: 'by hand' });
    assert.equal(results.manual.length - manualBefore, 1, 'the default allowlist did not leak in');
  } finally {
    br.configure({ config: null });
    config.setDryRun(false);
  }
});
```

Append to `test/watcher-mode-dispatch.test.js`:

```js
test('pickMode: the first early mode wins among several', () => {
  assert.equal(pick('--reply', 'Pipl', 'honored', '--score').mode, 'reply');
  assert.equal(pick('--decrypt-config').mode, 'encrypt-config');
});

test('pickMode: serp flags run inside the opt-out run, and conflict with another mode', () => {
  assert.equal(pick('--serp-scan').mode, 'run');
  assert.equal(pick('--serp-scan', '--doctor').mode, null);
});

test('pickMode: the conflict message names the flags in a fixed order', () => {
  assert.equal(pick('--doctor', '--report').conflict, 'Mutually exclusive modes cannot be combined: --report, --doctor. Use one at a time.');
});
```

In `test/modes-know-run.test.js`, in `run: one counter is made before the persons loop`, add:

```js
  assert.equal((src.match(/= makeEgressCounter\(/g) || []).length, 1, 'exactly one counter in run.js');
```

- [ ] **Step 2: Run them**

Run: `node --require ./test/helpers/egress-off.js --test test/forms-fill-report.test.js test/broker-runner-instances.test.js test/watcher-mode-dispatch.test.js test/modes-know-run.test.js test/modes-load.test.js test/umask-file-modes.test.js`, then `npm test`.
Expected: PASS. If the exact conflict string differs, check `resolveMode`'s message text and order and use the real string (the point is a fixed, exact assertion).

- [ ] **Step 3: Commit**

```bash
git add lib/mode-dispatch.js test/
git commit -m "test: checkbox wait, runner isolation from configure(), pickMode precedence, one counter, derived mode list"
```

---

### Task 6: Comment tidy-ups

**Files:** `lib/modes/complaints.js`, `lib/modes/update-brokers.js`, `lib/broker-runner.js`

- [ ] **Step 1: Edit**

- `lib/modes/complaints.js` header line: `lib/modes/complaints.js - --complaints: regulator complaints for brokers past the legal response window (moved from watcher.js).`
- `lib/modes/update-brokers.js`: move the comment block that starts `// ── --update-brokers: refresh data/feeds-brokers.json` (inside `run`) to directly above `async function run() {`, unchanged.
- `lib/broker-runner.js`: the JSDoc above `runBroker` starts `processBrokerWithPerson - run a single broker opt-out ...`; change that first line to `runBroker - run one broker opt-out for \`person\` with the given runner options (the default runner and createBrokerRunner both call it).` and keep the rest.

- [ ] **Step 2: Run the tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/modes/complaints.js lib/modes/update-brokers.js lib/broker-runner.js
git commit -m "chore: tidy mode header comments and the runBroker JSDoc"
```
