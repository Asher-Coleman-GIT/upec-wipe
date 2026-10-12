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
