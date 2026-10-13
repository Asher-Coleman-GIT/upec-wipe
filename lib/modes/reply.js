'use strict';
/**
 * lib/modes/reply.js - --reply <broker> <outcome>: log a reply to an email request, then exit (moved from watcher.js).
 */
const { saveState } = require('../config');
const lock = require('../lock');
const { acquireStateLockOrExit } = require('./shared');

// ── --reply <broker> <outcome>: log a reply to an email request, then exit ───
async function run({ argv }) {
  // The broker and outcome, skipping other flags and their values.
  const { query, outcome, extra } = require('../cli-flags').replyArgs(argv);
  const { recordReply, findEmailTarget, REPLY_OUTCOMES } = require('../email-step');
  const { loadCatalog, catalogEmailTargets } = require('../catalog');
  const brokersList = require('../../brokers');
  if (extra || !REPLY_OUTCOMES.includes(outcome)) {
    console.error(`Usage: upec-wipe reply <broker> ${REPLY_OUTCOMES.join('|')} [--right-to-know]`);
    process.exit(2);
  }
  // --right-to-know: the reply answers a right-to-know request ("know:" keys),
  // which only the email brokers in brokers.js receive.
  const forKnow = argv.includes('--right-to-know');
  const prefix = forKnow ? require('../right-to-know-runner').KNOW_PREFIX : '';
  const names = forKnow
    ? brokersList.filter(b => b.method === 'email' && b.emailTo).map(b => b.name)
    : [
      ...catalogEmailTargets(loadCatalog(undefined, () => {}), { explicitNames: new Set(brokersList.map(b => b.name.toLowerCase())) }).map(t => t.name),
      ...brokersList.filter(b => b.method === 'email').map(b => b.name),
    ];
  const found = findEmailTarget(names, query);
  if (found.error) { console.error(found.error); process.exit(2); }
  const replyLock = acquireStateLockOrExit();
  try {
    // Reload under the lock: a run may have written state since this process started.
    const st = require('../config').resetState();
    const base = prefix + found.name;
    const keys = Object.keys(st.emailSent || {}).filter(k => k === base || k.startsWith(`${base}|`));
    for (const key of (keys.length ? keys : [base])) recordReply(st, key, outcome);
    saveState();
  } finally {
    lock.release(replyLock);
  }
  console.log(`${found.name}: ${forKnow ? 'right-to-know ' : ''}reply logged as ${outcome}.`);
  process.exit(0);
}

module.exports = { run };
