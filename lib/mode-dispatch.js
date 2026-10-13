'use strict';

/**
 * lib/mode-dispatch.js
 *
 * Pure mode-resolution helper for watcher.js.
 *
 * resolveMode(flags) identifies which single mutually-exclusive operating mode
 * is active given the parsed CLI flags, and detects conflicts when more than
 * one is set simultaneously.
 *
 * @param {object} flags  Parsed flag booleans:
 *   { list, score, report, doctor, breachCheck, updateBrokers, pending,
 *     know, knowStatus, complaints, confirmEmails, serpScan, serpWatch,
 *     freeze, encryptConfig, decryptConfig }
 *   All default to false/undefined.
 *
 * @returns {{ mode: string|null, conflict: string|null }}
 *   mode     - the active mode name, or null for a normal run
 *   conflict - human-readable error when more than one exclusive mode is set
 */
function resolveMode(flags = {}) {
  const MODES = [
    { key: 'encryptConfig',    name: 'encrypt-config' },
    { key: 'decryptConfig',    name: 'decrypt-config' },
    { key: 'freeze',           name: 'freeze' },
    { key: 'list',             name: 'list' },
    { key: 'score',            name: 'score' },
    { key: 'pending',          name: 'pending' },
    { key: 'knowStatus',       name: 'know-status' },
    { key: 'breachCheck',      name: 'breach-check' },
    { key: 'complaints',       name: 'complaints' },
    { key: 'confirmEmails',    name: 'confirm-emails' },
    { key: 'report',           name: 'report' },
    { key: 'doctor',           name: 'doctor' },
    { key: 'updateBrokers',    name: 'update-brokers' },
    { key: 'serpScan',         name: 'serp-scan' },
    { key: 'serpWatch',        name: 'serp-watch' },
    { key: 'know',             name: 'know' },
  ];

  const active = MODES.filter(m => !!flags[m.key]);

  if (active.length > 1) {
    const names = active.map(m => `--${m.name}`).join(', ');
    return {
      mode: null,
      conflict: `Mutually exclusive modes cannot be combined: ${names}. Use one at a time.`,
    };
  }

  return {
    mode: active.length === 1 ? active[0].name : null,
    conflict: null,
  };
}

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

// Every mode name pickMode can return.
const MODE_NAMES = [...EARLY_MODES, ...LATE_MODES].map(([name]) => name).concat('run');

module.exports = { resolveMode, pickMode, MODE_NAMES };
