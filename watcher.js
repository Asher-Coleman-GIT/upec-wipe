#!/usr/bin/env node
/**
 * upec-wipe - watcher.js (entry point)
 *
 * Refuses what this fork never runs, parses the flags, picks one mode and runs
 * it from lib/modes/ (one file per mode; lib/modes/run.js is the opt-out run).
 * Run: node watcher.js   (add --dry-run to fill forms without submitting)
 */

// Audit M2: everything this process creates (run logs, audit files, snapshots,
// complaints, reports, config rewrites) is owner-only, however it was launched.
process.umask(0o077);

const { parseWatcherFlags } = require('./lib/cli-flags');
const { pickMode } = require('./lib/mode-dispatch');
const { resolveHeadless } = require('./lib/browser');
require('./lib/privilege').exitIfRoot();

// Audit M1: noise mode filled its "bogus" forms with the real person's name and
// alias and could mark real opt-outs done. It is disabled in this fork; refuse
// before any config is read or any browser module is loaded.
if (process.argv.includes('--pollute')) {
  console.error('--pollute is disabled in this fork: it submitted real personal data. See docs/THREAT-MODEL.md.');
  process.exit(1);
}

// The generic pass was retired: the reviewed catalog covers its sites, and the
// pass re-submitted to brokers the catalog excludes. Refuse before any config
// is read, as for --pollute.
if (process.argv.some(a => a === '--generic' || a.startsWith('--generic='))) {
  console.error('The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.');
  process.exit(1);
}

// Runs are manual only in this fork. Refuse the old flag rather than let it fall
// through to a real opt-out run.
if (process.argv.includes('--install-scheduler')) {
  console.error('--install-scheduler was removed: this fork runs only when you start it.');
  process.exit(1);
}

const flags = parseWatcherFlags(process.argv);
if (flags.EMAIL && flags.VERIFY) {
  console.error('--email cannot be combined with --verify.');
  process.exit(1);
}
// --assist: pause on bot-protection checks so the member can clear them in the
// browser window (lib/assist.js). Needs a visible window; refuse before any work.
if (flags.ASSIST && resolveHeadless()) {
  console.error('--assist needs a visible browser window (a desktop session, not HEADLESS=1 or a display-less server).');
  process.exit(1);
}

const picked = pickMode(flags);
if (picked.conflict) {
  console.error(`Error: ${picked.conflict}`);
  process.exit(1);
}

// A mode returns an exit code, or nothing to let the process end on its own
// (the opt-out run sets process.exitCode instead of exiting).
Promise.resolve()
  .then(() => require(`./lib/modes/${picked.mode}`).run({ flags, argv: process.argv }))
  .then((code) => { if (typeof code === 'number') process.exit(code); })
  .catch((err) => {
    console.error(require('./lib/modes/shared').formatFatal(err));
    process.exit(1);
  });
