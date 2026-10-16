/**
 * lib/serp-watch.js
 *
 * Continuous SERP monitoring + new-domain alerts.
 *
 * Extends the on-demand SERP scan (lib/serp-scan.js) into a watch: run a fresh
 * scan, diff the broker hostnames it surfaces against the hostnames recorded in
 * the previous data/serp-history.json snapshot, and report the new domains
 * in the result (the caller prints them) when the user's name appears on a NEW domain. Nothing leaves the
 * machine as a notification in this fork.
 *
 * Exported helpers (pure, no I/O - fully unit-testable):
 *   diffSerpResults(previous, current) -> { newDomains, goneDomains, stillPresent }
 *   summaryHostnames(summary)          -> string[]  broker hostnames in a scan summary
 *   historyHostnames(history)          -> string[]  distinct hostnames in a history array
 *   buildAlert(diff, persons)          -> string     concise alert text for new domains
 *
 * Orchestrator (deps injected so it is testable without a live browser):
 *   runSerpWatch(context, persons, brokers, opts)
 */

'use strict';

const serpScan = require('./serp-scan');

/**
 * Deduplicate a list of hostname strings, dropping falsy / empty values.
 * @param {Array<string>} list
 * @returns {Set<string>}
 */
function _cleanSet(list) {
  const out = new Set();
  for (const h of Array.isArray(list) ? list : []) {
    if (h && typeof h === 'string') out.add(h);
  }
  return out;
}

/**
 * Pure set diff of two hostname lists.
 *
 * @param {string[]} previous  Hostnames seen in the previous snapshot.
 * @param {string[]} current   Hostnames seen in the current scan.
 * @returns {{ newDomains: string[], goneDomains: string[], stillPresent: string[] }}
 *   newDomains   - in current, not in previous (the alert trigger)
 *   goneDomains  - in previous, not in current
 *   stillPresent - in both
 *   All arrays are deduplicated and sorted ascending.
 */
function diffSerpResults(previous, current) {
  const prev = _cleanSet(previous);
  const cur  = _cleanSet(current);

  const newDomains   = [...cur].filter(h => !prev.has(h)).sort();
  const goneDomains  = [...prev].filter(h => !cur.has(h)).sort();
  const stillPresent = [...cur].filter(h => prev.has(h)).sort();

  return { newDomains, goneDomains, stillPresent };
}

/**
 * Extract broker hostnames from a runSerpScan summary object.
 * Each result entry carries a `hostname` (added by runSerpScan); fall back to
 * deriving it from the broker name's absence by returning only present strings.
 *
 * @param {{ results?: Array<{ hostname?: string }> }} summary
 * @returns {string[]}
 */
function summaryHostnames(summary) {
  const results = summary && Array.isArray(summary.results) ? summary.results : [];
  const out = new Set();
  for (const r of results) {
    if (r && r.hostname) out.add(r.hostname);
  }
  return [...out];
}

/**
 * Extract the distinct set of hostnames recorded in a serp-history array.
 *
 * @param {Array<{ hostname?: string }>} history
 * @returns {string[]}
 */
function historyHostnames(history) {
  const out = new Set();
  for (const e of Array.isArray(history) ? history : []) {
    if (e && e.hostname) out.add(e.hostname);
  }
  return [...out];
}

/**
 * The hostnames of the latest scan in a serp-history array: the entries with
 * the newest scannedAt (one scan stamps all its entries alike). Every host
 * ever seen made a site gone for months show as gone on every run, and one
 * that came back never show as NEW (review 2026-10-15).
 *
 * @param {Array<{ hostname?: string, scannedAt?: string }>} history
 * @returns {string[]}
 */
function previousSnapshotHosts(history) {
  const all = (Array.isArray(history) ? history : []).filter(e => e && e.hostname);
  const entries = all.filter(e => e.scannedAt);
  // Undated entries (none are written today) count as one snapshot.
  if (!entries.length) return historyHostnames(all);
  const latest = entries.reduce((m, e) => (e.scannedAt > m ? e.scannedAt : m), '');
  return historyHostnames(entries.filter(e => e.scannedAt === latest));
}

/**
 * Run a SERP scan, diff against the previous history snapshot, and report new
 * domains in the result (the caller prints them). Nothing is sent anywhere.
 * Dependencies are injectable so this is testable without a live browser or
 * real disk:
 *   opts._runSerpScan(context, persons, brokers)  -> Promise<summary>
 *   opts._readHistory()                           -> history array
 *
 * @param {import('playwright').BrowserContext} context
 * @param {object[]} persons
 * @param {object[]} brokers
 * @param {object} [opts]
 * @returns {Promise<{ diff: object, summary: object }>}
 */
async function runSerpWatch(context, persons, brokers, opts = {}) {
  const readHistoryFn   = opts._readHistory   || serpScan.readHistory;
  const runScanFn       = opts._runSerpScan   || serpScan.runSerpScan;

  // Snapshot the PREVIOUS hostnames before the scan appends new entries to the
  // same history file.
  const previousHosts = previousSnapshotHosts(readHistoryFn());

  const summary = await runScanFn(context, persons, brokers, { assist: !!opts.assist, extraBrokers: opts.extraBrokers || [] });
  const currentHosts = summaryHostnames(summary);

  const diff = diffSerpResults(previousHosts, currentHosts);
  // A site is "gone" only when every engine was read: an unread engine
  // would make everything it usually shows look gone.
  const complete = !(summary && Array.isArray(summary.unreadable) && summary.unreadable.length);
  if (!complete) diff.goneDomains = [];

  return { diff, summary, complete };
}

const ENGINE_LABELS = { ddg: 'DuckDuckGo', google: 'Google' };

/**
 * The text serp-watch prints, and its exit code (1 when no engine could be
 * read: nothing was checked, so it must not look like a clean result).
 *
 * @param {{ summary: object, diff: object, complete: boolean }} watch
 * @returns {{ lines: string[], exitCode: number }}
 */
function formatWatchReport(watch) {
  const summary = watch.summary || {};
  const read = Array.isArray(summary.read) ? summary.read : [];
  const unreadable = Array.isArray(summary.unreadable) ? summary.unreadable : [];
  const lines = [];
  for (const u of unreadable) lines.push(`  ${u.label || ENGINE_LABELS[u.engine] || u.engine} could not be read: ${u.reason}`);
  if (read.length === 0) {
    lines.push('', '  Nothing was checked: no search engine could be read.');
    lines.push('  Run it at the computer (a visible browser window) with --assist and complete any bot check.');
    return { lines, exitCode: 1 };
  }
  if (unreadable.length) {
    lines.push(`  Only ${read.map(e => ENGINE_LABELS[e] || e).join(' and ')} was read; the list below covers that engine only.`);
  }

  const isNew = new Set(watch.diff.newDomains || []);
  const present = (summary.results || []).slice().sort((a, b) => a.hostname.localeCompare(b.hostname));
  lines.push('');
  if (present.length === 0) {
    lines.push('  No known broker site showed your name in the results that were read.');
  } else {
    lines.push(`  Broker sites showing your name (${present.length}):`);
    for (const r of present) lines.push(`     - ${r.hostname} (${r.broker})${isNew.has(r.hostname) ? ' - NEW' : ''}`);
  }
  const gone = watch.diff.goneDomains || [];
  if (gone.length) {
    lines.push('', `  No longer showing your name (${gone.length}):`);
    for (const h of gone) lines.push(`     - ${h}`);
  }
  return { lines, exitCode: 0 };
}

module.exports = {
  previousSnapshotHosts,
  diffSerpResults,
  summaryHostnames,
  historyHostnames,
  runSerpWatch,
  formatWatchReport,
};
