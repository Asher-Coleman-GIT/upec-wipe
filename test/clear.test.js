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
    const r = runIn(dir, 'bin/upec-wipe.js', ['clear'], { cwd: os.tmpdir() });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /clear needs an interactive terminal: nothing was deleted\./);
    assert.ok(fs.existsSync(path.join(dir, 'config.json')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the docs explain clear and clear-all', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const manual = read('docs/UPEC-MANUAL.md');
  assert.match(manual, /## Starting over or leaving/);
  assert.match(manual, /upec-wipe(\.js)? clear-all/);
  assert.match(manual, /simplelogin\.io/i);
  for (const f of ['README.md', 'docs/UPEC-MANUAL.md']) {
    assert.match(read(f), /^\| `clear` \|/m, f);
    assert.match(read(f), /^\| `clear-all` \|/m, f);
  }
  assert.match(read('docs/PRIVACY.md'), /upec-wipe clear-all/);
});

test('a state or serp-key path that names a directory is kept, never deleted', async () => {
  const s = sandbox();
  try {
    const dir = path.join(s.base, 'somedir');
    fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'x');
    for (const env of [{ UPEC_WIPE_SERP_KEY_PATH: dir }, { UPEC_WIPE_STATE_PATH: dir }]) {
      const p = planClear({ all: true, root: s.root, home: s.home, env });
      assert.equal(p.remove.includes(dir), false, JSON.stringify(env));
      assert.ok(p.keep.some(k => k.path === dir && /not a file/.test(k.reason)), JSON.stringify(env));
    }
    s.put('config.json');
    const { deps } = io('CLEAR ALL');
    assert.equal(await runClear({ all: true, root: s.root, home: s.home, env: { UPEC_WIPE_SERP_KEY_PATH: dir }, ...deps }), 0);
    assert.ok(fs.existsSync(path.join(dir, 'unrelated.txt')));
  } finally { s.cleanup(); }
});

test('a missing state directory does not claim a run is in progress', async () => {
  const s = sandbox();
  try {
    s.put('config.json');
    const env = { UPEC_WIPE_STATE_PATH: path.join(s.base, 'gone', 'dir', 'state.json') };
    const { out, deps } = io('CLEAR', { lock: require('../lib/lock') });
    assert.equal(await runClear({ all: false, root: s.root, home: s.home, env, ...deps }), 0);
    assert.equal(out.some(l => /run is in progress/.test(l)), false);
    assert.equal(fs.existsSync(path.join(s.root, 'config.json')), false);
  } finally { s.cleanup(); }
});

test('any other lock error is reported by code and deletes nothing', async () => {
  const s = sandbox();
  try {
    s.put('config.json');
    const { out, deps } = io('CLEAR', { lock: { acquire: () => { throw Object.assign(new Error('EACCES: /x'), { code: 'EACCES' }); }, release: () => {} } });
    assert.equal(await runClear({ all: false, root: s.root, home: s.home, env: {}, ...deps }), 1);
    assert.ok(out.includes('ERR Could not take the state lock: EACCES: nothing was deleted.'));
    assert.ok(fs.existsSync(path.join(s.root, 'config.json')));
  } finally { s.cleanup(); }
});
