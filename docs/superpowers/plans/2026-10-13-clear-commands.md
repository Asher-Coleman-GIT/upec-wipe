# `clear` and `clear-all` - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `upec-wipe clear` (delete the setup: config and default passphrase) and `upec-wipe clear-all` (delete everything UPEC-WIPE saved on this machine), each listing first and needing a typed confirmation at a terminal.

**Architecture:** One mode file, `lib/modes/clear.js`, with a pure planner (`planClear`), a lister (`describePlan`) and an injectable runner (`runClear`); the mode entry wires the real terminal. It computes every path from its inputs and never loads the config, so it works on a broken or encrypted config. Dispatch puts it first.

**Tech Stack:** Node.js (CommonJS), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-13-clear-commands-design.md`

## Global Constraints

- Runs after `docs/superpowers/plans/2026-10-13-retire-commands.md` (it uses `test/helpers/fixture-repo.js` from that plan's Task 1).
- **No test ever runs a deletion against the real tree.** Unit tests use a temp `root` and temp `home` with dummy files; the one spawn test uses the fixture copy from `test/helpers/fixture-repo.js` with a dummy `config.json` it writes itself.
- Never read or print the member's `config.json`, `state.json` or `logs/`.
- Confirmation words, exactly: `CLEAR` for `clear`, `CLEAR ALL` for `clear-all`. No `--yes` flag.
- Messages, exactly (from the spec): `Nothing to clear.`; `clear needs an interactive terminal: nothing was deleted.` (`clear-all needs ...` for clear-all); `Nothing was deleted.`; `A run is in progress (state.json.lock): nothing was deleted.`; `Deleted <path>`; `Could not delete <path>: <code>`; `Done. Run "upec-wipe setup" to start again.`; the three notice lines in spec section "Behaviour" item 2.
- Plain hyphens, no emoji, no real personal data (dummy files hold `{"person":{"firstName":"Jane"}}`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `UPEC_WIPE_STATE_PATH` pointing outside the repo: `clear-all` must delete that state family, not `root/state.json` only: Task 1 tests it.
2. A stale lock left by a crashed run (dead pid): `clear` must proceed (as runs do), not refuse forever: Task 2 tests it with an injected `isAlive`.
3. Answer with surrounding spaces (`" CLEAR "`): accepted after trim; lowercase `clear` refused: Task 2 tests both.
4. A symlinked `logs/` (a member pointing logs at another disk): `rmSync` on the link removes the link, not the target's contents. Task 1 lists it; Task 2 tests the target survives.
5. Running `clear` from another working directory: paths come from the repo root, not `cwd`: Task 3's spawn test runs with `cwd` set to a temp dir.

---

### Task 1: `planClear` and `describePlan`

**Files:**
- Create: `lib/modes/clear.js`
- Test: `test/clear.test.js` (create)

**Interfaces:**
- Produces: `planClear({ all, root, home, env }) -> { remove: string[], keep: { path: string, reason: string }[], lockPath: string }` (absolute paths that exist, in deletion order; `lockPath` always set).
- Produces: `describePlan(plan) -> string[]` (one line per entry: `  <path>  (<size>)`, directories `(<size>, <n> files)`, kept entries `  <path>  kept (<reason>)`).

- [ ] **Step 1: Write the failing tests**

`test/clear.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A temp repo root and home holding dummy files. Nothing here is real data.
function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-clear-'));
  const root = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(root, 'data', 'catalog'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'upec-wipe'), { recursive: true });
  const put = (rel, body = '{"person":{"firstName":"Jane"}}', at = root) => {
    fs.mkdirSync(path.dirname(path.join(at, rel)), { recursive: true });
    fs.writeFileSync(path.join(at, rel), body);
  };
  return { base, root, home, put, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

const { planClear, describePlan } = require('../lib/modes/clear');

test('clear plans the config files and the default passphrase only', () => {
  const s = sandbox();
  try {
    s.put('config.json'); s.put('config.json.enc'); s.put('state.json'); s.put('logs/run-1.json');
    s.put('.config/upec-wipe/passphrase', 'x', s.home);
    const p = planClear({ all: false, root: s.root, home: s.home, env: {} });
    assert.deepEqual(p.remove, [
      path.join(s.root, 'config.json'),
      path.join(s.root, 'config.json.enc'),
      path.join(s.home, '.config', 'upec-wipe', 'passphrase'),
    ]);
    assert.deepEqual(p.keep, []);
    assert.equal(p.lockPath, path.join(s.root, 'state.json.lock'));
  } finally { s.cleanup(); }
});

test('clear-all adds state, logs, serp files and leftovers; never repo files', () => {
  const s = sandbox();
  try {
    for (const f of ['config.json', 'state.json', 'state.json.bak', 'state.json.tmp', 'state.json.checkpoint',
      'state.json.checkpoint.tmp', 'logs/run-1.json', 'logs/snapshots/a.png', 'data/serp-history.json', 'data/.serp-key',
      'data/exposure-history.json', 'data/exposure-history.json.bak', 'inbox/confirms/a.eml',
      'data/catalog/example.com.json', 'data/feeds-brokers.json', 'data/dead-urls.json']) s.put(f);
    const p = planClear({ all: true, root: s.root, home: s.home, env: {} });
    const rel = p.remove.map(f => path.relative(s.root, f));
    assert.deepEqual(rel, ['config.json', 'state.json', 'state.json.bak', 'state.json.tmp', 'state.json.checkpoint',
      'state.json.checkpoint.tmp', 'logs', 'data/serp-history.json', 'data/.serp-key',
      'data/exposure-history.json', 'data/exposure-history.json.bak', 'inbox']);
  } finally { s.cleanup(); }
});

test('missing paths are left out, and nothing at all gives an empty plan', () => {
  const s = sandbox();
  try {
    const p = planClear({ all: true, root: s.root, home: s.home, env: {} });
    assert.deepEqual(p.remove, []);
  } finally { s.cleanup(); }
});

test('a custom passphrase file is kept, not removed', () => {
  const s = sandbox();
  try {
    const custom = path.join(s.base, 'vault', 'pp');
    fs.mkdirSync(path.dirname(custom), { recursive: true }); fs.writeFileSync(custom, 'x');
    const p = planClear({ all: false, root: s.root, home: s.home, env: { UPEC_WIPE_PASSPHRASE_FILE: custom } });
    assert.deepEqual(p.remove, []);
    assert.deepEqual(p.keep, [{ path: custom, reason: 'set by UPEC_WIPE_PASSPHRASE_FILE: delete it yourself if you no longer need it' }]);
  } finally { s.cleanup(); }
});

test('UPEC_WIPE_STATE_PATH and UPEC_WIPE_SERP_KEY_PATH are honoured', () => {
  const s = sandbox();
  try {
    const st = path.join(s.base, 'elsewhere', 'state.json');
    const key = path.join(s.base, 'elsewhere', 'serp.key');
    fs.mkdirSync(path.dirname(st), { recursive: true });
    fs.writeFileSync(st, '{}'); fs.writeFileSync(st + '.bak', '{}'); fs.writeFileSync(key, 'k');
    s.put('state.json');
    const p = planClear({ all: true, root: s.root, home: s.home, env: { UPEC_WIPE_STATE_PATH: st, UPEC_WIPE_SERP_KEY_PATH: key } });
    assert.ok(p.remove.includes(st) && p.remove.includes(st + '.bak') && p.remove.includes(key));
    assert.equal(p.remove.includes(path.join(s.root, 'state.json')), false);
    assert.equal(p.lockPath, st + '.lock');
  } finally { s.cleanup(); }
});

test('a symlinked logs folder is listed as the link', () => {
  const s = sandbox();
  try {
    const target = path.join(s.base, 'otherdisk');
    fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep.txt'), 'x');
    fs.symlinkSync(target, path.join(s.root, 'logs'), 'dir');
    const p = planClear({ all: true, root: s.root, home: s.home, env: {} });
    assert.ok(p.remove.includes(path.join(s.root, 'logs')));
  } finally { s.cleanup(); }
});

test('describePlan shows sizes, file counts and kept entries', () => {
  const s = sandbox();
  try {
    s.put('config.json', 'abcd'); s.put('logs/a.json', 'ab'); s.put('logs/b.json', 'ab');
    const p = planClear({ all: true, root: s.root, home: s.home, env: {} });
    p.keep.push({ path: '/x/pp', reason: 'why' });
    const lines = describePlan(p);
    assert.match(lines[0], /config\.json  \(4 B\)$/);
    assert.match(lines[1], /logs  \(4 B, 2 files\)$/);
    assert.equal(lines[2], '  /x/pp  kept (why)');
  } finally { s.cleanup(); }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/clear.test.js`
Expected: FAIL, `Cannot find module '../lib/modes/clear'`.

- [ ] **Step 3: Implement**

`lib/modes/clear.js`:

```js
'use strict';
/**
 * lib/modes/clear.js - `upec-wipe clear` (the setup: config and the default
 * passphrase) and `upec-wipe clear-all` (everything UPEC-WIPE saved here).
 * Never loads the config: it must work when the config is broken or
 * encrypted without its passphrase. See
 * docs/superpowers/specs/2026-10-13-clear-commands-design.md.
 */
const fs = require('fs');
const path = require('path');

const STATE_SUFFIXES = ['', '.bak', '.tmp', '.checkpoint', '.checkpoint.tmp'];
const LEFTOVERS = ['data/exposure-history.json', 'data/exposure-history.json.bak', 'inbox'];

function exists(p) {
  try { fs.lstatSync(p); return true; } catch (_) { return false; }
}

function planClear({ all, root, home, env }) {
  const statePath = env.UPEC_WIPE_STATE_PATH ? path.resolve(env.UPEC_WIPE_STATE_PATH) : path.join(root, 'state.json');
  const candidates = [path.join(root, 'config.json'), path.join(root, 'config.json.enc'),
    path.join(home, '.config', 'upec-wipe', 'passphrase')];
  const keep = [];
  if (env.UPEC_WIPE_PASSPHRASE_FILE) {
    const custom = path.resolve(env.UPEC_WIPE_PASSPHRASE_FILE);
    if (exists(custom)) keep.push({ path: custom, reason: 'set by UPEC_WIPE_PASSPHRASE_FILE: delete it yourself if you no longer need it' });
  }
  if (all) {
    for (const s of STATE_SUFFIXES) candidates.push(statePath + s);
    candidates.push(path.join(root, 'logs'), path.join(root, 'data', 'serp-history.json'),
      env.UPEC_WIPE_SERP_KEY_PATH ? path.resolve(env.UPEC_WIPE_SERP_KEY_PATH) : path.join(root, 'data', '.serp-key'));
    for (const rel of LEFTOVERS) candidates.push(path.join(root, rel));
  }
  const keptPaths = new Set(keep.map(k => k.path));
  const remove = candidates.filter(p => exists(p) && !keptPaths.has(p));
  return { remove, keep, lockPath: statePath + '.lock' };
}

function sizeOf(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return { bytes: st.size, files: null };
  let bytes = 0, files = 0;
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const sub = sizeOf(path.join(p, e.name));
    bytes += sub.bytes; files += sub.files === null ? 1 : sub.files;
  }
  return { bytes, files };
}

function human(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function describePlan(plan) {
  const lines = plan.remove.map(p => {
    const { bytes, files } = sizeOf(p);
    return `  ${p}  (${human(bytes)}${files === null ? '' : `, ${files} files`})`;
  });
  for (const k of plan.keep) lines.push(`  ${k.path}  kept (${k.reason})`);
  return lines;
}

module.exports = { planClear, describePlan };
```

(`sizeOf` uses `lstat`, so a symlinked `logs/` counts as the link itself: `(N B)` with no file count. That is fine.)

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test test/clear.test.js`
Expected: 7 pass. If the `describePlan` symlink case or sizes differ, fix the code, not the expected text.

- [ ] **Step 5: Commit**

```bash
git add lib/modes/clear.js test/clear.test.js
git commit -m "feat(clear): plan what clear and clear-all delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `runClear`: notices, confirmation, lock, delete

**Files:**
- Modify: `lib/modes/clear.js`
- Test: `test/clear.test.js` (append)

**Interfaces:**
- Consumes: `planClear`, `describePlan` (Task 1).
- Produces: `runClear({ all, root, home, env, isTTY, ask, log, error, lock }) -> Promise<number>` where `ask(question) -> Promise<string>`, `log(line)`, `error(line)`, `lock = { acquire(lockPath), release(lockPath) }` (defaults to `lib/lock.js`).

- [ ] **Step 1: Write the failing tests**

Append to `test/clear.test.js`:

```js
const { runClear } = require('../lib/modes/clear');

function io(answer, extra = {}) {
  const out = [];
  return {
    out,
    deps: {
      isTTY: true,
      ask: async (q) => { out.push(`ASK ${q}`); return answer; },
      log: (l) => out.push(l),
      error: (l) => out.push(`ERR ${l}`),
      lock: { acquire: () => {}, release: () => {} },
      ...extra,
    },
  };
}

test('no terminal refuses and deletes nothing', async () => {
  const s = sandbox();
  try {
    s.put('config.json');
    const { out, deps } = io('CLEAR', { isTTY: false });
    assert.equal(await runClear({ all: false, root: s.root, home: s.home, env: {}, ...deps }), 1);
    assert.ok(out.includes('ERR clear needs an interactive terminal: nothing was deleted.'));
    assert.ok(fs.existsSync(path.join(s.root, 'config.json')));
  } finally { s.cleanup(); }
});

test('a wrong word, lowercase, or closed input deletes nothing', async () => {
  for (const answer of ['no', 'clear', '']) {
    const s = sandbox();
    try {
      s.put('config.json');
      const { out, deps } = io(answer);
      assert.equal(await runClear({ all: false, root: s.root, home: s.home, env: {}, ...deps }), 1);
      assert.ok(out.includes('Nothing was deleted.'), answer);
      assert.ok(fs.existsSync(path.join(s.root, 'config.json')));
    } finally { s.cleanup(); }
  }
});

test('CLEAR (trimmed) deletes exactly the plan and keeps history', async () => {
  const s = sandbox();
  try {
    s.put('config.json'); s.put('state.json'); s.put('logs/run.json');
    s.put('.config/upec-wipe/passphrase', 'x', s.home);
    const { out, deps } = io('  CLEAR  ');
    assert.equal(await runClear({ all: false, root: s.root, home: s.home, env: {}, ...deps }), 0);
    assert.equal(fs.existsSync(path.join(s.root, 'config.json')), false);
    assert.equal(fs.existsSync(path.join(s.home, '.config', 'upec-wipe', 'passphrase')), false);
    assert.ok(fs.existsSync(path.join(s.root, 'state.json')));
    assert.ok(fs.existsSync(path.join(s.root, 'logs', 'run.json')));
    assert.ok(out.includes(`Deleted ${path.join(s.root, 'config.json')}`));
    assert.ok(out.includes('Done. Run "upec-wipe setup" to start again.'));
    assert.ok(out.some(l => l.startsWith('This does not delete: your SimpleLogin alias')));
    assert.ok(out.some(l => l.startsWith('Files are deleted normally, not overwritten')));
    assert.equal(out.some(l => /email every broker again/.test(l)), false, 'that warning is clear-all only');
  } finally { s.cleanup(); }
});

test('clear-all needs CLEAR ALL and warns about re-emailing', async () => {
  const s = sandbox();
  try {
    s.put('config.json'); s.put('state.json'); s.put('data/catalog/example.com.json');
    const plain = io('CLEAR');
    assert.equal(await runClear({ all: true, root: s.root, home: s.home, env: {}, ...plain.deps }), 1);
    assert.ok(fs.existsSync(path.join(s.root, 'state.json')));
    const { out, deps } = io('CLEAR ALL');
    assert.equal(await runClear({ all: true, root: s.root, home: s.home, env: {}, ...deps }), 0);
    assert.equal(fs.existsSync(path.join(s.root, 'state.json')), false);
    assert.ok(fs.existsSync(path.join(s.root, 'data', 'catalog', 'example.com.json')), 'repo files stay');
    assert.ok(out.includes('The next "run --email" will email every broker again, and your logged replies will be gone.'));
    assert.ok(out.includes('ASK Type CLEAR ALL to delete these files: '));
  } finally { s.cleanup(); }
});

test('a held lock refuses before asking', async () => {
  const s = sandbox();
  try {
    s.put('config.json');
    const { out, deps } = io('CLEAR', { lock: { acquire: () => { throw new Error('LockError: held by pid 42'); }, release: () => {} } });
    assert.equal(await runClear({ all: false, root: s.root, home: s.home, env: {}, ...deps }), 1);
    assert.ok(out.includes('ERR A run is in progress (state.json.lock): nothing was deleted.'));
    assert.equal(out.some(l => l.startsWith('ASK')), false);
    assert.ok(fs.existsSync(path.join(s.root, 'config.json')));
  } finally { s.cleanup(); }
});

test('a stale lock from a dead run does not block clear', async () => {
  const s = sandbox();
  try {
    s.put('config.json');
    fs.writeFileSync(path.join(s.root, 'state.json.lock'), JSON.stringify({ pid: 999999 }));
    const real = require('../lib/lock');
    const lock = { acquire: (p) => real.acquire(p, { isAlive: () => false }), release: real.release };
    const { deps } = io('CLEAR', { lock });
    assert.equal(await runClear({ all: false, root: s.root, home: s.home, env: {}, ...deps }), 0);
    assert.equal(fs.existsSync(path.join(s.root, 'config.json')), false);
  } finally { s.cleanup(); }
});

test('a failing delete is reported by code, the rest continue, exit 1', async () => {
  const s = sandbox();
  try {
    s.put('config.json'); s.put('config.json.enc');
    const { out, deps } = io('CLEAR', {
      rm: (p) => { if (p.endsWith('config.json')) throw Object.assign(new Error('EACCES: /secret/path'), { code: 'EACCES' }); fs.rmSync(p, { recursive: true, force: true }); },
    });
    assert.equal(await runClear({ all: false, root: s.root, home: s.home, env: {}, ...deps }), 1);
    assert.ok(out.includes(`ERR Could not delete ${path.join(s.root, 'config.json')}: EACCES`));
    assert.equal(out.some(l => l.includes('/secret/path')), false);
    assert.equal(fs.existsSync(path.join(s.root, 'config.json.enc')), false);
  } finally { s.cleanup(); }
});

test('nothing to clear says so and exits 0 without asking', async () => {
  const s = sandbox();
  try {
    const { out, deps } = io('CLEAR');
    assert.equal(await runClear({ all: true, root: s.root, home: s.home, env: {}, ...deps }), 0);
    assert.ok(out.includes('Nothing to clear.'));
    assert.equal(out.some(l => l.startsWith('ASK')), false);
  } finally { s.cleanup(); }
});

test('a symlinked logs folder: the link goes, the target stays', async () => {
  const s = sandbox();
  try {
    const target = path.join(s.base, 'otherdisk');
    fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep.txt'), 'x');
    fs.symlinkSync(target, path.join(s.root, 'logs'), 'dir');
    const { deps } = io('CLEAR ALL');
    assert.equal(await runClear({ all: true, root: s.root, home: s.home, env: {}, ...deps }), 0);
    assert.equal(fs.existsSync(path.join(s.root, 'logs')), false);
    assert.ok(fs.existsSync(path.join(target, 'keep.txt')));
  } finally { s.cleanup(); }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/clear.test.js`
Expected: the 9 new tests FAIL (`runClear is not a function`).

- [ ] **Step 3: Implement**

Add to `lib/modes/clear.js` before `module.exports`, and export `runClear`:

```js
const NOT_REACHED = 'This does not delete: your SimpleLogin alias (delete it at simplelogin.io), emails already sent or opt-outs already submitted, your dedicated mailbox, copies brokers hold, or any backup of this folder.';
const NO_OVERWRITE = 'Files are deleted normally, not overwritten: on SSDs and on WSL\'s /mnt/c an overwrite does not reliably destroy the old data.';
const REEMAIL = 'The next "run --email" will email every broker again, and your logged replies will be gone.';

async function runClear({ all, root, home, env, isTTY, ask, log, error, lock = require('../lock'), rm = (p) => fs.rmSync(p, { recursive: true, force: true }) }) {
  const name = all ? 'clear-all' : 'clear';
  const plan = planClear({ all, root, home, env });
  if (plan.remove.length === 0) {
    for (const l of describePlan(plan)) log(l);
    log('Nothing to clear.');
    return 0;
  }
  if (!isTTY) { error(`${name} needs an interactive terminal: nothing was deleted.`); return 1; }
  try {
    lock.acquire(plan.lockPath);
  } catch (_) {
    error(`A run is in progress (${path.basename(plan.lockPath)}): nothing was deleted.`);
    return 1;
  }
  let code = 0;
  try {
    log(`${name} will delete:`);
    for (const l of describePlan(plan)) log(l);
    log('');
    log(NOT_REACHED);
    log(NO_OVERWRITE);
    if (all) log(REEMAIL);
    const word = all ? 'CLEAR ALL' : 'CLEAR';
    const answer = String(await ask(`Type ${word} to delete these files: `)).trim();
    if (answer !== word) { log('Nothing was deleted.'); return 1; }
    for (const p of plan.remove) {
      try { rm(p); log(`Deleted ${p}`); } catch (err) { error(`Could not delete ${p}: ${err.code || 'error'}`); code = 1; }
    }
    log('Done. Run "upec-wipe setup" to start again.');
    return code;
  } finally {
    lock.release(plan.lockPath);
  }
}
```

Note: the lock path is `state.json.lock`, which for the default state path lives in `root`. `lock.release` unlinks it (it is ours), so `clear-all` ends with no lock file, as the spec asks.

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test test/clear.test.js`
Expected: 16 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/modes/clear.js test/clear.test.js
git commit -m "feat(clear): confirm, lock and delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wire the commands

**Files:**
- Modify: `lib/modes/clear.js` (add `run({ flags, argv })`)
- Modify: `lib/cli-flags.js` (`CLEAR`, `CLEAR_ALL`), `lib/mode-dispatch.js` (`clear` first in `EARLY_MODES`), `lib/cli-map.js` (two entries)
- Test: `test/clear.test.js` (append)

**Interfaces:**
- Consumes: `runClear` (Task 2), `makeFixtureRepo`/`runIn` from `test/helpers/fixture-repo.js` (retire-commands plan Task 1).
- Produces: `pickMode({ CLEAR: true })` and `pickMode({ CLEAR_ALL: true })` return `{ mode: 'clear' }`.

- [ ] **Step 1: Write the failing tests**

Append to `test/clear.test.js`:

```js
const { makeFixtureRepo, runIn } = require('./helpers/fixture-repo');

test('dispatch routes clear and clear-all first, before modes that load config', () => {
  const { pickMode } = require('../lib/mode-dispatch');
  const { parseWatcherFlags } = require('../lib/cli-flags');
  assert.equal(pickMode(parseWatcherFlags(['node', 'watcher.js', '--clear'])).mode, 'clear');
  assert.equal(pickMode(parseWatcherFlags(['node', 'watcher.js', '--clear-all'])).mode, 'clear');
  assert.equal(pickMode(parseWatcherFlags(['node', 'watcher.js', '--clear', '--list'])).mode, 'clear');
});

test('the clear mode never loads the config', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'modes', 'clear.js'), 'utf8');
  assert.doesNotMatch(src, /loadConfig|require\('\.\.\/config'\)|require\('\.\/shared'\)/);
});

test('help lists clear and clear-all', () => {
  const help = require('../lib/cli-map').buildHelp();
  assert.match(help, /^\s+clear\s+Delete your setup \(config and passphrase\); keeps history$/m);
  assert.match(help, /^\s+clear-all\s+Delete everything UPEC-WIPE saved on this machine$/m);
});

test('upec-wipe clear without a terminal refuses and deletes nothing (fixture, other cwd)', () => {
  const dir = makeFixtureRepo();
  try {
    fs.writeFileSync(path.join(dir, 'config.json'), '{"person":{"firstName":"Jane"}}');
    const r = runIn(dir, 'bin/upec-wipe.js', ['clear']);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /clear needs an interactive terminal: nothing was deleted\./);
    assert.ok(fs.existsSync(path.join(dir, 'config.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
```

`runIn` (from the retire-commands plan) sets `cwd: dir`. For Review Focus 5, give `runIn` an optional `opts.cwd` and pass `{ cwd: os.tmpdir() }` here if adding it is a one-line change; otherwise ledger that the cwd case is covered by `resolveSpawnTarget` already using the repo root.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --require ./test/helpers/egress-off.js --test test/clear.test.js`
Expected: the 4 new tests FAIL. The spawn test fails safely: in the fixture, `upec-wipe clear` is an unknown command (exit 2), and the fixture's only config is the dummy one.

- [ ] **Step 3: Implement**

`lib/modes/clear.js`:

```js
async function run({ flags }) {
  const os = require('os');
  return runClear({
    all: !!flags.CLEAR_ALL,
    root: path.join(__dirname, '..', '..'),
    home: os.homedir(),
    env: process.env,
    isTTY: !!(process.stdin.isTTY && process.stdout.isTTY),
    ask: (q) => new Promise((resolve) => {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      let answered = false;
      rl.question(q, (a) => { answered = true; rl.close(); resolve(a); });
      rl.on('close', () => { if (!answered) resolve(''); });
    }),
    log: (l) => console.log(l),
    error: (l) => console.error(l),
  });
}
```

(Same prompt shape as `askLine` in `lib/modes/shared.js`, inlined because `shared.js` pulls in config and email modules.) Export `run`.

`lib/cli-flags.js`: add `CLEAR: has('--clear'),` and `CLEAR_ALL: has('--clear-all'),` to the returned object.

`lib/mode-dispatch.js`: first entry of `EARLY_MODES`: `['clear', (f) => f.CLEAR || f.CLEAR_ALL],`.

`lib/cli-map.js`, after `setup`:

```js
  clear:            { file: 'watcher.js',          flags: ['--clear'],          cwd: 'root',      desc: 'Delete your setup (config and passphrase); keeps history' },
  'clear-all':      { file: 'watcher.js',          flags: ['--clear-all'],      cwd: 'root',      desc: 'Delete everything UPEC-WIPE saved on this machine' },
```

Check `watcher.js` requires nothing that loads config before dispatch (after the retire-commands plan it requires only `lib/cli-flags`, `lib/mode-dispatch`, `lib/browser`, `lib/privilege`). If `test/cli-map.test.js` pins the command count or list, add the two.

- [ ] **Step 4: Verify**

Run: `node --require ./test/helpers/egress-off.js --test test/clear.test.js test/cli-map.test.js test/watcher-mode-dispatch.test.js && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/modes/clear.js lib/cli-flags.js lib/mode-dispatch.js lib/cli-map.js test/
git commit -m "feat: upec-wipe clear and clear-all

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs

**Files:**
- Modify: `docs/UPEC-MANUAL.md` (new "Starting over or leaving" section before "Command reference"; two command-table rows), `README.md` (two command-table rows), `docs/REFERENCE.md` (one paragraph under "Run results and state"), `docs/PRIVACY.md` ("What stays on your machine" names the commands)
- Test: `test/clear.test.js` (append)

- [ ] **Step 1: Write the failing test**

```js
test('the docs explain clear and clear-all', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const manual = read('docs/UPEC-MANUAL.md');
  assert.match(manual, /## Starting over or leaving/);
  assert.match(manual, /upec-wipe clear-all/);
  assert.match(manual, /simplelogin\.io/i);
  for (const f of ['README.md', 'docs/UPEC-MANUAL.md']) {
    assert.match(read(f), /^\| `clear` \|/m, f);
    assert.match(read(f), /^\| `clear-all` \|/m, f);
  }
  assert.match(read('docs/PRIVACY.md'), /upec-wipe clear-all/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/clear.test.js`
Expected: FAIL on the manual heading.

- [ ] **Step 3: Write the docs**

`docs/UPEC-MANUAL.md`, before "Command reference":

```markdown
## Starting over or leaving

`node bin/upec-wipe.js clear` deletes your setup: `config.json` (or `config.json.enc`) and the passphrase file. Your history and logs stay, so you can run `setup` again, for example with a new mailbox, and the tool still knows what it already sent.

`node bin/upec-wipe.js clear-all` deletes everything the tool saved on this computer: the setup, `state.json` (your opt-out and email history and logged replies), `logs/` and the search history. After it, the next `run --email` would email every broker again.

Both list what they will delete and ask you to type `CLEAR` (or `CLEAR ALL`). Neither can delete your SimpleLogin alias (do that at simplelogin.io), emails already sent, your dedicated mailbox, what brokers already hold, or backups of this folder. Files are deleted normally, not overwritten.
```

Command tables (README and manual): `| \`clear\` | Deletes your setup (config and passphrase); keeps history |` and `| \`clear-all\` | Deletes everything UPEC-WIPE saved on this computer |` (the manual's table has a third "Sends" column: `Nothing.`).

`docs/REFERENCE.md`, end of "Run results and state": `To forget the history, use \`upec-wipe clear-all\` (it deletes \`state.json\` with everything else); \`upec-wipe clear\` keeps it.`

`docs/PRIVACY.md` "What stays on your machine": add `To delete it all, run \`upec-wipe clear-all\`; \`upec-wipe clear\` deletes only the config and passphrase.`

- [ ] **Step 4: Verify**

Run: `node --test test/clear.test.js && npm test`
Expected: all pass (including `test/no-em-dashes.test.js` and the retire-commands docs test).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/UPEC-MANUAL.md docs/REFERENCE.md docs/PRIVACY.md test/clear.test.js
git commit -m "docs: clear and clear-all

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Finish

- [ ] `npm test` green.
- [ ] Final whole-branch review (most capable model) covering both plans, with both Review Focus sections.
- [ ] Count-only personal-data check; merge and push as the member chooses.
