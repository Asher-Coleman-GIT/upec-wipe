/**
 * lib/config.js
 *
 * Config + opt-out state management.
 *
 * `state` is a single shared mutable object for the lifetime of the process.
 * `recordSuccess` writes state.json via `saveState()`.
 *
 * Dry-run: call `setDryRun(true)` and `recordSuccess`/`saveState` become
 * no-op-on-disk (in-memory mutation still happens, harmless). This closes the
 * original bug where the notFound/email paths persisted state.json even though
 * `--dry-run` promised "no state will be saved".
 *
 * `resetState()` reloads state from disk *in place* so existing references
 * (e.g. watcher.js's `const state = loadState()`) stay valid - used by tests
 * and the upcoming --verify mode for isolation.
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const secrets = require('./secrets');

const CONFIG_PATH     = path.join(__dirname, '..', 'config.json');
const CONFIG_ENC_PATH = path.join(__dirname, '..', 'config.json.enc');
const STATE_PATH      = process.env.UPEC_WIPE_STATE_PATH
  ? path.resolve(process.env.UPEC_WIPE_STATE_PATH)
  : path.join(__dirname, '..', 'state.json');

/**
 * Mode for every file that holds PII or credentials: config.json,
 * config.json.enc, state.json, state.json.bak, the checkpoint.
 *
 * These were previously created with the process umask, i.e. 0644 on a default
 * Linux/macOS box - readable by every local account. Harmless on a single-user
 * laptop, a real exposure on the multi-user machines this tool gets deployed to
 * (a NAS with family accounts, a shared VPS, a box running other containers
 * under different uids).
 */
const OWNER_ONLY = 0o600;

// Environment variable that supplies the passphrase for at-rest config encryption.
const PASSPHRASE_ENV = 'UPEC_WIPE_PASSPHRASE';
// Optional file holding the passphrase (Docker secret, etc).
const PASSPHRASE_FILE_ENV = 'UPEC_WIPE_PASSPHRASE_FILE';

// Read a passphrase from a file. Strips one trailing \n or \r\n. Refuses a
// file readable by group/other. Throws on an empty (whitespace-only after
// stripping) file.
function readPassphraseFile(filePath) {
  const st = fs.statSync(filePath);
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    throw new Error(`Passphrase file ${filePath} is readable by other users. Run: chmod 600 "${filePath}"`);
  }
  const value = fs.readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
  if (!value) throw new Error(`Passphrase file ${filePath} is empty`);
  return value;
}

// Default passphrase file, relative to the home directory. The manual has
// members create it before setup; reading it last means doctor/preview/run work
// unprefixed after --encrypt-config.
const DEFAULT_PASSPHRASE_REL = path.join('.config', 'upec-wipe', 'passphrase');

// Resolve the active passphrase. Order: explicit override, UPEC_WIPE_PASSPHRASE,
// UPEC_WIPE_PASSPHRASE_FILE, then the default file
// ~/.config/upec-wipe/passphrase if it exists (same group/other
// mode check as UPEC_WIPE_PASSPHRASE_FILE; only ENOENT counts as "not present").
// '' when none is available.
// `env` defaults to process.env; tests pass a plain object instead. `home`
// defaults to env.HOME for an injected env, else os.homedir().
function getPassphrase(override, env, home) {
  const e = env || process.env;
  if (override !== undefined && override !== null && override !== '') return override;
  if (e[PASSPHRASE_ENV]) return e[PASSPHRASE_ENV];
  if (e[PASSPHRASE_FILE_ENV]) {
    try {
      return readPassphraseFile(e[PASSPHRASE_FILE_ENV]);
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error(`${PASSPHRASE_FILE_ENV} points to a missing file: ${e[PASSPHRASE_FILE_ENV]}`);
      throw err;
    }
  }
  const h = home !== undefined ? home : (env ? e.HOME : os.homedir());
  if (h) {
    try {
      return readPassphraseFile(path.join(h, DEFAULT_PASSPHRASE_REL));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return '';
}

// Test-only override for the state file path. null means use STATE_PATH.
let _testStatePath = null;

// Checkpoint path for interrupted-run resume support.
// Default: STATE_PATH + '.checkpoint'; overridden in tests via setTestCheckpointPath.
let _checkpointPath = null;

function _getCheckpointPath() {
  return _checkpointPath || (STATE_PATH + '.checkpoint');
}

function setTestCheckpointPath(p) {
  _checkpointPath = p || null;
}

function saveCheckpoint(brokerName) {
  if (dryRun) return;
  // Atomic tmp + rename (B11): a kill mid-write must never leave an empty
  // checkpoint, which would make --resume silently restart from the top.
  writeFileFsync(_getCheckpointPath(), brokerName + '\n');
}

function loadCheckpoint() {
  const p = _getCheckpointPath();
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').trim() || null;
}

function clearCheckpoint() {
  const p = _getCheckpointPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function getStatePath() {
  return _testStatePath || STATE_PATH;
}

/**
 * True iff `parsed` has the shape of a usable state object: a plain object
 * (not null, not an array) that carries an `optOuts` object. A hand-edited or
 * truncated state.json that parses to `[]`, `42`, or `{foo:1}` is rejected so
 * the "crash-safe load" fallback (.bak / empty) actually kicks in instead of
 * later throwing on `state.optOuts[...]`.
 *
 * @param {unknown} parsed
 * @returns {boolean}
 */
function isValidStateShape(parsed) {
  return (
    !!parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    !!parsed.optOuts &&
    typeof parsed.optOuts === 'object' &&
    !Array.isArray(parsed.optOuts)
  );
}

/**
 * Read and parse a JSON state file safely.
 * Returns the parsed object on success, or null on any error
 * (file missing, unreadable, invalid JSON, or wrong shape).
 *
 * @param {string} filePath - Absolute path to the file to read.
 * @returns {object|null}
 */
// Audit L15: optOuts is keyed by broker name from disk; drop keys that could
// reach Object.prototype when later code does state.optOuts[name] = ....
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function safeOptOuts(src) {
  const out = {};
  for (const [k, v] of Object.entries(src || {})) {
    if (!UNSAFE_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Read and parse a JSON file. V8's SyntaxError quotes the text around the
 * error (personal data), so a parse failure is rethrown as a SyntaxError that
 * names only the file. `contentFree` marks it as safe to print.
 * @param {string} file
 * @returns {*}
 */
function readJsonFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    const e = new SyntaxError(`${path.basename(file)} is not valid JSON`);
    e.contentFree = true;
    throw e;
  }
}

function readStateFileSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (!isValidStateShape(parsed)) return null;
    parsed.optOuts = safeOptOuts(parsed.optOuts);
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * For tests only: override the state file path so tests don't touch the real file.
 * Pass null to reset to the default STATE_PATH.
 * @param {string|null} p
 */
function setTestStatePath(p) {
  _testStatePath = p || null;
}

const RECHECK_DAYS = 90; // how often to re-submit to a broker
const CONFIRM_RECHECK_DAYS = 14; // retry pending-confirmation brokers after this many days

// Returns the parsed config. Backward compatible:
//   - If config.json.enc exists, decrypt it with the passphrase (env or opts).
//   - Else if config.json's JSON is itself an envelope, decrypt that in place.
//   - Else treat config.json as plaintext (warns if a passphrase is set, since
//     the user likely intended encryption but the file is still in the clear).
// opts (all optional, used by tests + helpers): { configPath, encPath,
//   passphrase, _warn }. With no opts the real paths + UPEC_WIPE_PASSPHRASE are used.
function loadConfig(opts) {
  const o = opts || {};
  const configPath = o.configPath || CONFIG_PATH;
  const encPath    = o.encPath || CONFIG_ENC_PATH;
  const passphrase = getPassphrase(o.passphrase);
  const warn       = o._warn || ((m) => console.warn(m));

  if (fs.existsSync(encPath)) {
    if (!passphrase) {
      throw new Error(`Encrypted config found (${encPath}) but no passphrase. Create ~/${DEFAULT_PASSPHRASE_REL.split(path.sep).join('/')} (mode 600), or set ${PASSPHRASE_ENV} or ${PASSPHRASE_FILE_ENV}.`);
    }
    const env = readJsonFile(encPath);
    return secrets.decryptConfig(env, passphrase);
  }

  if (!fs.existsSync(configPath)) {
    console.error('Error: config.json not found. Run `node setup.js` first.');
    process.exit(1);
  }

  const parsed = readJsonFile(configPath);
  if (secrets.isEncryptedEnvelope(parsed)) {
    if (!passphrase) {
      throw new Error(`Encrypted config found (${configPath}) but no passphrase. Create ~/${DEFAULT_PASSPHRASE_REL.split(path.sep).join('/')} (mode 600), or set ${PASSPHRASE_ENV} or ${PASSPHRASE_FILE_ENV}.`);
    }
    return secrets.decryptConfig(parsed, passphrase);
  }

  if (passphrase) {
    warn(`Warning: ${PASSPHRASE_ENV} is set but config is plaintext. Run \`node watcher.js --encrypt-config\` to encrypt it.`);
  }
  return parsed;
}

// True iff an encrypted config exists on disk (enc file, or an envelope-shaped config.json).
function isConfigEncrypted(opts) {
  const o = opts || {};
  const configPath = o.configPath || CONFIG_PATH;
  const encPath    = o.encPath || CONFIG_ENC_PATH;
  if (fs.existsSync(encPath)) return true;
  if (!fs.existsSync(configPath)) return false;
  try {
    return secrets.isEncryptedEnvelope(readJsonFile(configPath));
  } catch (_) {
    return false;
  }
}

/**
 * Move `tmp` onto `target`, falling back to an in-place write when the rename
 * cannot work.
 *
 * rename() is the atomic primitive every durable write here relies on, but it
 * fails with EBUSY when `target` is a Docker single-file bind mount (the kernel
 * holds the mount on that inode) and with EXDEV when tmp and target are on
 * different devices. The documented `docker run -v ./state.json:/app/state.json`
 * recipe hits the EBUSY case on every write, so without this fallback the
 * container persisted no state at all and re-submitted every broker on every
 * run.
 *
 * The fallback gives up atomicity, which is a real loss - a kill mid-write can
 * truncate the target. saveState() still writes a .bak, and loadState() already
 * recovers from it, so the exposure is one interrupted write rather than lost
 * history. Persisting non-atomically beats not persisting.
 *
 * Any other error is rethrown: EACCES and friends are genuine misconfiguration
 * and must not be papered over.
 */
// Best-effort: an existing file keeps its old mode through a rename, and some
// filesystems (exFAT, a Windows share, a bind mount) reject chmod entirely.
function _chmodOwnerOnly(target) {
  try { fs.chmodSync(target, OWNER_ONLY); } catch (_) {}
}

function _renameOrRewrite(tmp, target, data, beforeRewrite) {
  try {
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    if (err.code !== 'EBUSY' && err.code !== 'EXDEV' && err.code !== 'EPERM') throw err;
    // beforeRewrite() returning false means the in-place write is unsafe:
    // fail loudly and leave the old valid file(s) untouched.
    if (typeof beforeRewrite === 'function' && beforeRewrite() === false) {
      const why = err.code === 'EXDEV'
        ? 'it sits on a different drive or mount than its temporary file'
        : 'another program is holding it';
      const fix = err.code === 'EXDEV'
        ? 'keep state.json and its folder on one drive and run again'
        : 'close that program and run again';
      const locked = new Error(`${path.basename(target)} could not be saved safely: ${why} (${err.code}). Nothing was lost; ${fix}.`);
      locked.code = err.code;
      locked.cause = err;
      throw locked;
    }
    fs.writeFileSync(target, data, { mode: OWNER_ONLY });
    try { fs.unlinkSync(tmp); } catch (_) {}
    return false;
  }
}

// Durable write: write `data` to a temp file, fsync it (best-effort), then
// atomically rename into place. Mirrors saveState()'s guarantees so a crash
// after the rename never leaves a zero-length target. Shared by saveState,
// saveCheckpoint, and the config-encryption migrations (B10, B11).
function writeFileFsync(target, data) {
  const tmp = target + '.tmp';
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', OWNER_ONLY);
    fs.writeSync(fd, data);
    try { fs.fsyncSync(fd); } catch (_) {} // best-effort: some FSes/platforms lack fsync
    fs.closeSync(fd);
    fd = undefined;
  } catch (err) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    throw err;
  }
  _renameOrRewrite(tmp, target, data);
  _chmodOwnerOnly(target);
}

// Atomic + fsync'd write of a JSON value: tmp -> fsync -> rename. Used by the
// config-encryption migrations so an interrupted --encrypt-config never leaves
// a truncated config.json.enc when the plaintext has already been shredded.
function writeJsonAtomic(target, value) {
  writeFileFsync(target, JSON.stringify(value, null, 2));
}

// Migration: read plaintext config, write an encrypted envelope to encPath.
// Optionally shred (delete) the plaintext afterward. Returns { encPath }.
function encryptConfigToDisk(opts) {
  const o = opts || {};
  const configPath = o.configPath || CONFIG_PATH;
  const encPath    = o.encPath || CONFIG_ENC_PATH;
  const passphrase = getPassphrase(o.passphrase);
  if (!passphrase) throw new Error(`No passphrase. Set ${PASSPHRASE_ENV} or ${PASSPHRASE_FILE_ENV}, or pass one in.`);
  if (!fs.existsSync(configPath)) throw new Error(`Plaintext config not found: ${configPath}`);
  const plain = readJsonFile(configPath);
  if (secrets.isEncryptedEnvelope(plain)) throw new Error('config.json is already encrypted');
  const envelope = secrets.encryptConfig(plain, passphrase);
  writeJsonAtomic(encPath, envelope);
  if (o.shred) {
    fs.rmSync(configPath, { force: true });
  }
  return { encPath, shredded: !!o.shred };
}

// Migration: read the encrypted envelope, write plaintext config.json.
// Optionally remove the envelope afterward. Returns { configPath }.
function decryptConfigToDisk(opts) {
  const o = opts || {};
  const configPath = o.configPath || CONFIG_PATH;
  const encPath    = o.encPath || CONFIG_ENC_PATH;
  const passphrase = getPassphrase(o.passphrase);
  if (!passphrase) throw new Error(`No passphrase. Set ${PASSPHRASE_ENV} or ${PASSPHRASE_FILE_ENV}, or pass one in.`);
  let env;
  if (fs.existsSync(encPath)) {
    env = readJsonFile(encPath);
  } else if (fs.existsSync(configPath)) {
    env = readJsonFile(configPath);
  } else {
    throw new Error('No encrypted config found to decrypt');
  }
  const plain = secrets.decryptConfig(env, passphrase);
  writeJsonAtomic(configPath, plain);
  if (o.removeEnc && fs.existsSync(encPath)) {
    fs.rmSync(encPath, { force: true });
  }
  return { configPath, removedEnc: !!o.removeEnc };
}

// state.json tracks opt-out history so completed opt-outs aren't re-submitted
// every single run (brokers re-add data every ~90 days, so we re-check then).
//
// The eager init is wrapped in readStateFileSafe so a corrupt/truncated
// state.json at require-time does NOT crash the whole tool. Instead it falls
// back to the .bak file, and if that also fails, to an empty state object.
let state = (() => {
  const primary = readStateFileSafe(STATE_PATH);
  if (primary) return primary;
  const bak = readStateFileSafe(STATE_PATH + '.bak');
  if (bak) return bak;
  return { optOuts: {} };
})();

let dryRun = false;

function setDryRun(v) {
  dryRun = !!v;
}

function loadState() {
  return state;
}

// Reload state.json in place so existing references stay valid.
// Falls back to the .bak file when the primary is missing OR corrupt (SyntaxError
// recovery from a crash mid-write). Falls back to empty state when both fail.
function resetState() {
  const target = getStatePath();
  const bak = target + '.bak';
  const fresh =
    readStateFileSafe(target) ||
    readStateFileSafe(bak) ||
    { optOuts: {} };
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, fresh);
  return state;
}

// A .bak that is a hard link of `target` shares its inode. Before anything
// writes `target` in place, give the .bak its own copy of the old state, or an
// interrupted write would truncate both. Returns false only when they share
// and the copy could not be made; the caller must then not write in place.
//
// When the fallback triggers because another program holds state.json, that
// program usually holds the linked .bak too, so this detach usually fails and
// the save stops. That is the intended fail-closed outcome: do not "fix" it by
// weakening the shared check or by writing in place anyway.
function _detachBak(target, bak) {
  let t;
  try { t = fs.statSync(target); } catch (_) { return true; } // no target yet: nothing to share
  let b;
  try {
    b = fs.statSync(bak);
  } catch (err) {
    if (err.code === 'ENOENT') return true; // no .bak: nothing to share
    // Could not tell: safe only when nothing else links the target.
    if (t.nlink > 1) return false;
    return true;
  }
  // The link count catches sharing even where inode numbers are unreliable
  // (drvfs, network shares); the dev+ino pair catches it everywhere else.
  const shared = t.nlink > 1 || (t.ino === b.ino && t.dev === b.dev);
  if (!shared) return true;
  const bakTmp = bak + '.tmp';
  try {
    try { fs.unlinkSync(bakTmp); } catch (_) {}
    fs.copyFileSync(target, bakTmp);
    // During the in-place write this copy is the only intact old state.
    const fd = fs.openSync(bakTmp, 'r+');
    try { fs.fsyncSync(fd); } catch (_) {} finally { fs.closeSync(fd); } // fsync is best-effort, as for the primary
    fs.renameSync(bakTmp, bak);
    return true;
  } catch (_) {
    try { fs.unlinkSync(bakTmp); } catch (__) {}
    return false;
  }
}

// Flush a folder so a rename inside it survives a power cut. Best-effort:
// Windows and some filesystems cannot open or fsync a folder.
function _fsyncDir(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (_) {
    // not supported here
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

function saveState() {
  if (dryRun) return; // dry-run promises no persisted state
  const target = getStatePath();
  const tmp    = target + '.tmp';
  const bak    = target + '.bak';
  const bakTmp = bak + '.tmp';

  // (a) Write the new state to a temp file, fsync it (best-effort), then
  //     atomically rename into place so a kill mid-write never truncates target.
  const data = JSON.stringify(state, null, 2);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w', OWNER_ONLY);
    fs.writeSync(fd, data);
    try { fs.fsyncSync(fd); } catch (_) {} // best-effort: some FSes/platforms lack fsync
    fs.closeSync(fd);
    fd = undefined;
  } catch (err) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    throw err;
  }
  // Single atomic rename: on POSIX this is guaranteed atomic. Degrades to an
  // in-place write when target is a bind mount or on another device - see
  // _renameOrRewrite.
  const renamed = _renameOrRewrite(tmp, target, data, () => _detachBak(target, bak));
  _chmodOwnerOnly(target);
  _fsyncDir(path.dirname(target));

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
    _fsyncDir(path.dirname(bak)); // the .bak's new name too
  } catch (_) {
    // Best-effort: if the backup fails we still have the primary.
    try { fs.unlinkSync(bakTmp); } catch (__) {}
  }
}

function lastOptOutDaysAgo(brokerName) {
  const entry = state.optOuts[brokerName];
  if (!entry?.lastSuccess) return Infinity;
  return (Date.now() - new Date(entry.lastSuccess).getTime()) / (1000 * 60 * 60 * 24);
}

const HISTORY_MAX = 5;

// Defunct detection needs at least DEFUNCT_THRESHOLD trailing history entries to
// see a run of consecutive errors; if HISTORY_MAX ever drops below it, defunct
// detection silently breaks. Fail loudly at load time instead (B21).
{
  const { DEFUNCT_THRESHOLD } = require('./defunct');
  if (HISTORY_MAX < DEFUNCT_THRESHOLD) {
    throw new Error(
      `HISTORY_MAX (${HISTORY_MAX}) must be >= DEFUNCT_THRESHOLD (${DEFUNCT_THRESHOLD}); ` +
      'defunct detection needs the full run of trailing history entries.'
    );
  }
}

function appendHistory(brokerName, kind) {
  const entry = state.optOuts[brokerName] || {};
  const history = [...(entry.history || []), kind].slice(-HISTORY_MAX);
  state.optOuts[brokerName] = { ...entry, history };
}

function recordSuccess(brokerName, detail = '') {
  appendHistory(brokerName, 'success');
  const prev = state.optOuts[brokerName] || {};
  // Single clock read (B23): lastAttempt must not predate lastSuccess by a tick.
  const now = new Date().toISOString();
  state.optOuts[brokerName] = {
    ...prev,
    lastSuccess: now,
    lastAttempt: now,
    lastDetail: detail || prev.lastDetail || '',
    totalRuns: (prev.totalRuns || 0) + 1,
  };
  // Clear any stale pending state - both canonical and legacy key names.
  delete state.optOuts[brokerName].pendingConfirm;
  delete state.optOuts[brokerName].pendingConfirmation;
  delete state.optOuts[brokerName].manual;
  saveState();
}

// Record an explicit failure kind ('error', 'captcha_failed') for drift tracking.
function recordFailure(brokerName, kind) {
  appendHistory(brokerName, kind);
  saveState();
}

// WP4: record that the form was submitted but the broker is awaiting email
// confirmation. Stored separately from full successes so the regular 90-day
// re-check window does not apply - pending entries are retried after
// CONFIRM_RECHECK_DAYS so the user has a chance to click the confirmation link.
function recordPendingConfirmation(brokerName, snippet = '') {
  appendHistory(brokerName, 'pending_confirm');
  const prev = state.optOuts[brokerName] || {};
  const now = new Date().toISOString();
  state.optOuts[brokerName] = {
    ...prev,
    lastAttempt: now,
    pendingConfirm: { since: now, snippet: snippet || '' },
    totalRuns: (prev.totalRuns || 0) + 1,
    // Unified on lastDetail (B7): recordSuccess also writes lastDetail; the old
    // `detail` field was never read anywhere.
    lastDetail: snippet || prev.lastDetail || '',
  };
  delete state.optOuts[brokerName].manual;
  saveState();
}

// A site the run handed to the member (manual, or a CAPTCHA it could not
// solve). `upec-wipe manual` lists these with their links; a later success,
// a pending confirmation or `upec-wipe done` clears it. `since` stays the
// first time it was listed.
function recordManual(brokerName, detail = '', firstSeen) {
  const prev = state.optOuts[brokerName] || {};
  const since = (prev.manual && prev.manual.since) || firstSeen || new Date().toISOString();
  state.optOuts[brokerName] = { ...prev, manual: { since, detail: detail || '' } };
  saveState();
}

// True iff the broker is currently in pending-confirmation state.
function isPendingConfirmation(brokerName) {
  return !!(state.optOuts[brokerName]?.pendingConfirm);
}

// Days since the last attempt (lastSuccess OR lastAttempt). Used together with
// `isPendingConfirmation` to decide whether to re-attempt a pending entry.
function lastAttemptDaysAgo(brokerName) {
  const entry = state.optOuts[brokerName];
  if (!entry) return Infinity;
  const stamp = entry.lastAttempt || entry.lastSuccess;
  if (!stamp) return Infinity;
  return (Date.now() - new Date(stamp).getTime()) / (1000 * 60 * 60 * 24);
}

// Decide whether to skip a broker this run. Returns either null (do NOT skip)
// or `{ reason }` with a human-readable explanation logged as the skip detail.
function shouldSkip(brokerName) {
  const entry = state.optOuts[brokerName];
  if (!entry) return null;
  if (entry.pendingConfirm) {
    const daysAgo = lastAttemptDaysAgo(brokerName);
    if (daysAgo < CONFIRM_RECHECK_DAYS) {
      const daysLeft = Math.max(0, Math.round(CONFIRM_RECHECK_DAYS - daysAgo));
      return { reason: `Pending email confirmation - retry in ${daysLeft}d if still unconfirmed` };
    }
    return null; // confirmation window elapsed, re-attempt
  }
  const daysAgo = lastOptOutDaysAgo(brokerName);
  if (daysAgo < RECHECK_DAYS) {
    const daysLeft = Math.round(RECHECK_DAYS - daysAgo);
    return { reason: `Last removed ${Math.round(daysAgo)}d ago - re-check in ${daysLeft}d` };
  }
  return null;
}

/**
 * Returns an array of {name, since, snippet, expectedSender?} for all brokers
 * currently in pending_confirm state (i.e. pendingConfirm exists and
 * no later success has been recorded).
 *
 * @param {Array<{name: string, expectedSender?: string}>} [brokers]
 *   Optional broker definitions. When provided, the expectedSender field
 *   from the matching broker definition is included in each result entry.
 */
function getPendingConfirmations(brokers) {
  const brokerMap = new Map((brokers || []).map(b => [b.name, b]));
  const entries = [];
  for (const [name, entry] of Object.entries(state.optOuts || {})) {
    if (entry && entry.pendingConfirm && entry.pendingConfirm.since) {
      // Only pending if no later success
      const pendingSince = new Date(entry.pendingConfirm.since);
      const lastSuccess = entry.lastSuccess ? new Date(entry.lastSuccess) : null;
      if (!lastSuccess || pendingSince > lastSuccess) {
        const brokerDef = brokerMap.get(name);
        entries.push({
          name,
          since: entry.pendingConfirm.since,
          snippet: entry.pendingConfirm.snippet || '',
          expectedSender: brokerDef?.expectedSender,
        });
      }
    }
  }
  return entries.sort((a, b) => a.since.localeCompare(b.since));
}

/**
 * Return the canonical state key for a (brokerName, person, totalPersons) triple.
 *
 * Single-person mode (totalPersons <= 1 OR no person): returns bare broker name.
 * Multi-person mode (totalPersons > 1 AND person provided): returns "BrokerName|First Last".
 *
 * This is the single source of truth used by both broker-runner (write) and
 * verify-loop (read), ensuring their keys always match.
 *
 * @param {string} brokerName
 * @param {object|null|undefined} person
 * @param {number|undefined} totalPersons
 * @returns {string}
 */
function stateKey(brokerName, person, totalPersons) {
  if (!person || (totalPersons || 1) <= 1) return brokerName;
  return `${brokerName}|${person.firstName} ${person.lastName}`;
}

/**
 * Find the index of the broker whose stateKey equals `checkpoint` (B22).
 *
 * saveCheckpoint stores the composite key ("Broker|First Last") in multi-person
 * mode, so --resume must compute the same key per broker instead of comparing
 * against the bare broker.name (which silently re-runs everything in
 * multi-person mode). Returns -1 when no broker matches or checkpoint is empty.
 *
 * @param {Array<{ name: string }>} brokers
 * @param {string|null|undefined} checkpoint
 * @param {object|null|undefined} person
 * @param {number|undefined} totalPersons
 * @returns {number}
 */
function findResumeIndex(brokers, checkpoint, person, totalPersons) {
  if (!checkpoint) return -1;
  return (brokers || []).findIndex(
    b => stateKey(b.name, person, totalPersons) === checkpoint
  );
}

/**
 * Extracts the array of persons from a config object.
 * Supports both:
 *   { "person": {...} }          - existing single-person format
 *   { "persons": [{...}, {...}] } - new multi-person format
 *
 * The "persons" array takes precedence over "person" when both are present.
 */
function getPersonsFromConfig(config) {
  if (config.persons !== undefined) {
    if (!Array.isArray(config.persons) || config.persons.length === 0) {
      throw new Error('config.persons must be a non-empty array');
    }
    return config.persons;
  }
  if (config.person) {
    return [config.person];
  }
  throw new Error('config.json must include "person" or "persons"');
}

/**
 * A printable reason for a config read/parse failure. A JSON SyntaxError
 * quotes the config text around the error (personal data), so it gets a fixed
 * reason; other errors here name only paths and env vars.
 * @param {Error} err
 * @returns {string}
 */
function configErrorReason(err) {
  if (err instanceof SyntaxError) return err.contentFree ? err.message : 'config.json is not valid JSON';
  return (err && err.message) || String(err);
}

module.exports = {
  configErrorReason,
  readJsonFile,
  CONFIG_PATH,
  CONFIG_ENC_PATH,
  PASSPHRASE_ENV,
  PASSPHRASE_FILE_ENV,
  STATE_PATH,
  RECHECK_DAYS,
  CONFIRM_RECHECK_DAYS,
  HISTORY_MAX,
  OWNER_ONLY,
  writeFileFsync,
  _renameOrRewrite,
  readStateFileSafe,
  loadConfig,
  getPassphrase,
  readPassphraseFile,
  isConfigEncrypted,
  encryptConfigToDisk,
  decryptConfigToDisk,
  loadState,
  resetState,
  setDryRun,
  saveState,
  setTestStatePath,
  lastOptOutDaysAgo,
  lastAttemptDaysAgo,
  isPendingConfirmation,
  shouldSkip,
  recordSuccess,
  recordPendingConfirmation,
  recordManual,
  recordFailure,
  getPendingConfirmations,
  getPersonsFromConfig,
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  setTestCheckpointPath,
  stateKey,
  findResumeIndex,
};
