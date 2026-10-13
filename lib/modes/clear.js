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
