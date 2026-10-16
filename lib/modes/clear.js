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

const STATE_SUFFIXES = ['', '.bak', '.tmp', '.bak.tmp', '.checkpoint', '.checkpoint.tmp'];
const LEFTOVERS = ['data/exposure-history.json', 'data/exposure-history.json.bak', 'inbox', 'dashboard'];

function exists(p) {
  try { fs.lstatSync(p); return true; } catch (_) { return false; }
}

function planClear({ all, root, home, env }) {
  const statePath = env.UPEC_WIPE_STATE_PATH ? path.resolve(env.UPEC_WIPE_STATE_PATH) : path.join(root, 'state.json');
  // .tmp: what an interrupted write leaves (config.json.tmp is plain text).
  const candidates = [path.join(root, 'config.json'), path.join(root, 'config.json.enc'),
    path.join(root, 'config.json.tmp'), path.join(root, 'config.json.enc.tmp'),
    path.join(home, '.config', 'upec-wipe', 'passphrase')];
  const keep = [];
  if (env.UPEC_WIPE_PASSPHRASE_FILE) {
    const custom = path.resolve(env.UPEC_WIPE_PASSPHRASE_FILE);
    if (exists(custom)) keep.push({ path: custom, reason: 'set by UPEC_WIPE_PASSPHRASE_FILE: delete it yourself if you no longer need it' });
  }
  if (all) {
    for (const s of STATE_SUFFIXES) candidates.push(statePath + s);
    candidates.push(path.join(root, 'logs'), path.join(root, 'data', 'serp-history.json'), path.join(root, 'data', 'serp-history.json.tmp'),
      env.UPEC_WIPE_SERP_KEY_PATH ? path.resolve(env.UPEC_WIPE_SERP_KEY_PATH) : path.join(root, 'data', '.serp-key'));
    for (const rel of LEFTOVERS) candidates.push(path.join(root, rel));
  }
  // Only logs/, inbox/ and the old dashboard/ folder (a leftover) may be
  // directories. A state or serp-key path that names a directory (a stale env
  // var pointing at $HOME) is never deleted.
  const dirsOk = new Set([path.join(root, 'logs'), path.join(root, 'inbox'), path.join(root, 'dashboard')]); // dashboard: leftover
  const keptPaths = new Set(keep.map(k => k.path));
  const remove = [];
  for (const p of candidates) {
    if (!exists(p) || keptPaths.has(p)) continue;
    const st = fs.lstatSync(p);
    if (dirsOk.has(p) || st.isFile() || st.isSymbolicLink()) remove.push(p);
    else { keep.push({ path: p, reason: 'not a file: delete it yourself if you mean to' }); keptPaths.add(p); }
  }
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

// An unreadable subfolder must not stop the listing.
function safeSize(p) {
  try { return sizeOf(p); } catch (_) { return null; }
}

function human(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function describePlan(plan) {
  const lines = plan.remove.map(p => {
    const size = safeSize(p);
    if (!size) return `  ${p}  (size unknown)`;
    return `  ${p}  (${human(size.bytes)}${size.files === null ? '' : `, ${size.files} files`})`;
  });
  for (const k of plan.keep) lines.push(`  ${k.path}  kept (${k.reason})`);
  return lines;
}

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
  log(`${name} would delete:`);
  for (const l of describePlan(plan)) log(l);
  if (!isTTY) { error(`${name} needs an interactive terminal: nothing was deleted.`); return 1; }
  let locked = false;
  try {
    lock.acquire(plan.lockPath);
    locked = true;
  } catch (err) {
    if (/^LockError/.test(String(err && err.message))) {
      error(`A run is in progress (${path.basename(plan.lockPath)}): nothing was deleted.`);
      return 1;
    }
    // No state directory means no run can hold its lock: carry on unlocked.
    if (!(err && err.code === 'ENOENT')) {
      error(`Could not take the state lock: ${(err && err.code) || 'error'}: nothing was deleted.`);
      return 1;
    }
  }
  let code = 0;
  try {
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
    if (locked) lock.release(plan.lockPath);
  }
}

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

module.exports = { planClear, describePlan, runClear, run };
