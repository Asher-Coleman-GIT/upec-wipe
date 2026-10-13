'use strict';
/**
 * lib/retired-flags.js - flags this fork removed, and the one line each prints.
 * watcher.js checks them before any config is read: a flag that fell through
 * would start a real opt-out run. Requires nothing.
 */
const SEE_REF = 'See docs/REFERENCE.md.';
const CCPA = `it cited California law (CCPA) for every non-EU member. ${SEE_REF}`;
const SCORE = `the exposure score depended on the breach check. ${SEE_REF}`;
const FREEZE = 'the freeze checklist is in docs/UPEC-MANUAL.md.';
const REMOVED = [
  { flag: '--generic', message: 'The generic pass was retired: its sites are in the reviewed catalog (data/catalog/). Remove --generic.' },
  ...['--know', '--know-status', '--complaints'].map(flag => ({ flag, message: `${flag} was removed: ${CCPA}` })),
  { flag: '--breach-check', message: `--breach-check was removed: it sent your real email to Have I Been Pwned. ${SEE_REF}` },
  ...['--score', '--report'].map(flag => ({ flag, message: `${flag} was removed: ${SCORE}` })),
  ...['--freeze', '--freeze-done', '--freeze-clear'].map(flag => ({ flag, message: `${flag} was removed: ${FREEZE}` })),
  { flag: '--snapshot', message: `--snapshot was removed: it saved screenshots of forms with your details. ${SEE_REF}` },
  { flag: '--confirm-emails', message: `--confirm-emails was removed: click confirmation links yourself. ${SEE_REF}` },
  { flag: '--serp-scan', message: '--serp-scan was removed: use upec-wipe serp-watch.' },
  { flag: '--update-brokers', message: '--update-brokers moved: run node scripts/update-catalog-sources.js.' },
  { flag: '--right-to-know', message: `--right-to-know was removed with the know command. ${SEE_REF}` },
];

// The message to print and exit on, or null. Retired flags first (also as
// --flag=value); then any other --flag=value, since no flag here takes
// "=value" and an unrecognised one used to be ignored, which turned
// --clear-all=yes or --preview=1 into a real run.
function checkRetired(argv) {
  const args = argv.slice(2);
  for (const { flag, message } of REMOVED) {
    if (args.some(a => a === flag || a.startsWith(`${flag}=`))) return message;
  }
  const eq = args.find(a => /^--[^=]+=/.test(a));
  return eq ? `${eq} is not a valid flag: write the value as the next argument.` : null;
}

module.exports = { REMOVED, checkRetired };
