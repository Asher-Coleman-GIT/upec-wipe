/**
 * lib/filter.js
 *
 * Helpers for CLI filter flags: --only, --skip, --retry-failed, --list.
 *
 * Exports:
 *   parseList(arg)                    - splits comma-separated names, trims whitespace
 *   applyFilter(brokers, opts)        - returns filtered broker array
 *   loadLastLog(logsDir)              - reads newest run-*.json, returns parsed object or null
 *   extractFailedBrokers(log)         - returns Set of broker names from error/captcha/pending buckets
 */

const fs = require('fs');
const path = require('path');

/**
 * Split a comma-separated string into trimmed, non-empty name tokens.
 * @param {string} arg
 * @returns {string[]}
 */
function parseList(arg) {
  if (!arg) return [];
  return arg.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * --only names that match no known broker or site, each with the closest
 * known name (same letters in another case, a cut-off start, or a near typo)
 * or null. A name broken by a line break in a paste ("Data Part" + "ners")
 * shows up here instead of running an empty pass.
 *
 * @param {string} arg     the --only value
 * @param {string[]} known every broker and catalog site name
 * @returns {Array<{ name: string, suggestion: string|null }>}
 */
function unknownNames(arg, known) {
  const set = new Set(known);
  const dist = (a, b) => {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  };
  return parseList(arg).filter(n => !set.has(n)).map(name => {
    const low = name.toLowerCase();
    const suggestion = known.find(k => k.toLowerCase() === low) ||
      (low.length >= 4 && known.find(k => k.toLowerCase().startsWith(low))) ||
      known.find(k => dist(k.toLowerCase(), low) <= 2) || null;
    return { name, suggestion };
  });
}

/**
 * Apply --only / --skip / --retry-failed filter to a broker array.
 *
 * Priority: only > retryFailedFromLog > skip.
 * If no option is set, returns the full list unchanged.
 *
 * @param {Array<{name: string}>} brokers
 * @param {{ only?: string, skip?: string, retryFailedFromLog?: Set<string> }} [opts]
 * @returns {Array<{name: string}>}
 */
/**
 * The lines to print and stop on before a run does anything, or null: --only
 * with --skip or --retry-failed (applyFilter would drop one silently), and
 * --only/--skip names that match nothing (a misspelt --skip submitted the
 * broker the member meant to leave out).
 */
function checkRunNames({ only, skip, retryFailed, known }) {
  const given = [only && '--only', skip && '--skip', retryFailed && '--retry-failed'].filter(Boolean);
  if (given.length > 1) return [`${given.join(' and ')} cannot be combined: use one of them. Nothing was run.`];
  const lines = [];
  for (const [flag, arg] of [['--only', only], ['--skip', skip]]) {
    if (!arg) continue;
    for (const u of unknownNames(arg, known)) {
      lines.push(`${flag}: no broker or catalog site is named "${u.name}"${u.suggestion ? ` (did you mean "${u.suggestion}"?)` : ''}.`);
    }
  }
  if (!lines.length) return null;
  lines.push('Names must match exactly (upec-wipe list shows them); paste the list on one line. Nothing was run.');
  return lines;
}

function applyFilter(brokers, opts = {}) {
  const { only, skip, retryFailedFromLog } = opts;

  if (only) {
    const names = new Set(parseList(only));
    return brokers.filter(b => names.has(b.name));
  }

  if (retryFailedFromLog) {
    return brokers.filter(b => retryFailedFromLog.has(b.name));
  }

  if (skip) {
    const names = new Set(parseList(skip));
    return brokers.filter(b => !names.has(b.name));
  }

  return brokers;
}

/**
 * Read the most recently named run-*.json file from logsDir.
 * Returns parsed JSON object, or null on any error (missing dir, no files, bad JSON).
 *
 * @param {string} logsDir
 * @returns {object|null}
 */
function loadLastLog(logsDir) {
  try {
    const files = fs.readdirSync(logsDir)
      .filter(f => /^run-.*\.json$/.test(f))
      .sort();

    if (files.length === 0) return null;

    const latest = files[files.length - 1];
    const content = fs.readFileSync(path.join(logsDir, latest), 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Given a run log (errors, captchaFailed, pendingConfirm arrays of the
 * { broker, status, ... } entries logResult writes; older logs used { name }),
 * return a Set of broker names that should be retried.
 *
 * @param {object} log
 * @param {Array<{broker?:string,name?:string}>} [log.errors]
 * @param {Array<{broker?:string,name?:string}>} [log.captchaFailed]
 * @param {Array<{broker?:string,name?:string}>} [log.pendingConfirm]
 * @returns {Set<string>}
 */
function extractFailedBrokers(log) {
  const names = new Set();
  for (const bucket of ['errors', 'captchaFailed', 'pendingConfirm']) {
    for (const entry of (log[bucket] || [])) {
      const name = entry.broker || entry.name;
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * Case-insensitive, whitespace-tolerant membership test for the broker allowlist.
 *
 * A broker on the allowlist is one the user explicitly wants to STAY listed on,
 * so the run loops skip it and verification never flags it as still-listed.
 *
 * @param {string} name    Broker name (e.g. broker.name).
 * @param {{ allowlist?: string[] }} [config]  Parsed config object.
 * @returns {boolean}
 */
function isAllowlisted(name, config) {
  if (!name || !config || !Array.isArray(config.allowlist)) return false;
  const target = String(name).trim().toLowerCase();
  if (!target) return false;
  return config.allowlist.some(entry => String(entry).trim().toLowerCase() === target);
}

module.exports = { parseList, applyFilter, checkRunNames, loadLastLog, extractFailedBrokers, isAllowlisted, unknownNames };
