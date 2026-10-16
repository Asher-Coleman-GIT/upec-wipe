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
    WEB_CHECK: has('--web-check'),
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
    READ_EMAIL: has('--read-email'),
    SINCE_ARG: valueAfter(argv, '--since'),
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
 * The brokers given to --done: the plain arguments after it, skipping other
 * flags and their values like replyArgs. A name with spaces must be quoted.
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
  return { queries: plain };
}

// Every flag watcher.js and its modes read. Anything else starting with "--"
// refuses: an unknown flag used to be ignored, so `run --emial` started a real
// web-form run.
const KNOWN_FLAGS = new Set([
  '--preview', '--email', '--forms', '--assist', '--dry-run', '--verify', '--web-check', '--read-email', '--since',
  '--doctor', '--only', '--skip', '--retry-failed', '--list', '--pending', '--manual',
  '--import-last-run', '--done', '--no-capsolver', '--resume', '--encrypt-config',
  '--decrypt-config', '--keep-plaintext', '--reply', '--clear', '--clear-all',
  '--allow', '--unallow',
]);

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The message to print and exit on for the first unknown flag, or null.
 * Values of --only and the like never start with "--", so only flags are seen.
 */
// Flags whose next argument is their value. `run --only --assist "A,B"` took
// "--assist" as the list (2026-10-15) and ran an empty pass.
const VALUE_FLAGS = ['--only', '--skip', '--since'];

function checkUnknownFlags(argv) {
  const args = argv.slice(2);
  const bad = args.find(a => a.startsWith('--') && !KNOWN_FLAGS.has(a));
  if (!bad) {
    for (const f of VALUE_FLAGS) {
      const i = args.indexOf(f);
      // An empty value (an unset shell variable) used to mean "no filter".
      if (i !== -1 && (args[i + 1] === undefined || args[i + 1].startsWith('--') || !args[i + 1].replace(/[\s,]/g, ''))) {
        return `${f} needs a value right after it, e.g. ${f} ${f === '--since' ? '2026-10-01' : '"Spokeo,Pipl"'} (other flags such as --assist go before ${f} or after its value).`;
      }
    }
    return strayWord(args);
  }
  let best = null;
  let bestDist = 3; // a typo is at most two edits away
  for (const f of KNOWN_FLAGS) {
    const d = editDistance(bad, f);
    if (d < bestDist) { best = f; bestDist = d; }
  }
  return best
    ? `${bad} is not a valid flag (did you mean ${best}?).`
    : `${bad} is not a valid flag. Run upec-wipe --help for the commands.`;
}

// Flags whose next argument is a name, and commands that take plain names.
const NAME_FLAGS = ['--allow', '--unallow'];
const WORD_COMMANDS = ['--done', '--reply'];
const DASHES = /^[-\u2010-\u2015\u2212]+/;

/**
 * A word that is not a flag is accepted only as a flag's value, as a name for
 * done or reply, or as `doctor`. Ignored, `run -h`, `run Spokeo` or
 * `run -only Spokeo` started a full real run (review 2026-10-15).
 */
function strayWord(args) {
  const takesWords = args.some(a => WORD_COMMANDS.includes(a));
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.includes(a) || NAME_FLAGS.includes(a)) k++;
      continue;
    }
    if ((k === 0 && a === 'doctor') || takesWords) continue;
    if (/^-h(elp)?$/.test(a)) return `${a} is not a flag here. For help run upec-wipe --help.`;
    if (DASHES.test(a)) {
      const guess = `--${a.replace(DASHES, '')}`;
      return KNOWN_FLAGS.has(guess)
        ? `${a} is not a valid flag (did you mean ${guess}?).`
        : `${a} is not a valid flag. Run upec-wipe --help for the commands.`;
    }
    return `"${a}" is not a flag. To limit a run to one broker use --only "${a}".`;
  }
  return null;
}

module.exports = { parseWatcherFlags, replyArgs, doneArgs, KNOWN_FLAGS, checkUnknownFlags };
