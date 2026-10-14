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
  return {
    PREVIEW,
    EMAIL,
    FORMS: has('--forms') || !EMAIL,
    ASSIST: has('--assist'),
    DRY_RUN: has('--dry-run') || PREVIEW, // --preview implies --dry-run
    VERIFY: has('--verify'),
    SERP_WATCH: has('--serp-watch'),
    DOCTOR: argv[2] === 'doctor' || has('--doctor'),
    ONLY_ARG: valueAfter(argv, '--only'),
    SKIP_ARG: valueAfter(argv, '--skip'),
    RETRY_FAILED: has('--retry-failed'),
    LIST_MODE: has('--list'),
    PENDING_MODE: has('--pending'),
    MANUAL_MODE: has('--manual'),
    DONE: has('--done'),
    NO_CAPSOLVER: has('--no-capsolver'),
    RESUME: has('--resume'),
    ENCRYPT_CONFIG: has('--encrypt-config'),
    DECRYPT_CONFIG: has('--decrypt-config'),
    KEEP_PLAINTEXT: has('--keep-plaintext'),
    REPLY: has('--reply'),
    CLEAR: has('--clear'),
    CLEAR_ALL: has('--clear-all'),
    ALLOWLIST_CMD: parseAllowlistArgs(argv),
  };
}

// Flags that take the next argument as their value when reading --reply's
// arguments. Unlike valueAfter() above, a following "--flag" is never taken as
// a value here.
const REPLY_SKIP_VALUE = new Set(['--only', '--skip', '--allow', '--unallow']);

/**
 * The broker and outcome given to --reply: the first two plain arguments after
 * it, skipping other flags and their values, so --only X can sit anywhere. `extra` is true when a third plain argument follows, so the
 * caller can refuse instead of guessing. (A broker name that starts with "--"
 * is read as a flag; no broker is named that way.)
 */
function replyArgs(argv) {
  const i = argv.indexOf('--reply');
  const plain = [];
  for (let k = i + 1; i !== -1 && k < argv.length; k++) {
    const a = argv[k];
    if (a.startsWith('--')) {
      if (REPLY_SKIP_VALUE.has(a) && argv[k + 1] !== undefined && !argv[k + 1].startsWith('--')) k++;
      continue;
    }
    plain.push(a);
  }
  return { query: plain[0] || '', outcome: plain[1] || '', extra: plain.length > 2 };
}

/**
 * The broker given to --done: the plain arguments after it, skipping other
 * flags and their values like replyArgs. `extra` is true when more than one
 * is given (a name with spaces must be quoted).
 */
function doneArgs(argv) {
  const i = argv.indexOf('--done');
  const plain = [];
  for (let k = i + 1; i !== -1 && k < argv.length; k++) {
    const a = argv[k];
    if (a.startsWith('--')) {
      if (REPLY_SKIP_VALUE.has(a) && argv[k + 1] !== undefined && !argv[k + 1].startsWith('--')) k++;
      continue;
    }
    plain.push(a);
  }
  return { query: plain[0] || '', extra: plain.length > 1 };
}

module.exports = { parseWatcherFlags, replyArgs, doneArgs };
