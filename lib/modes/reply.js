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
  const { logReplyFor, findEmailTarget, replyNames, REPLY_OUTCOMES } = require('../email-step');
  const { loadCatalog, catalogEmailTargets } = require('../catalog');
  const brokersList = require('../../brokers');
  if (extra || !REPLY_OUTCOMES.includes(outcome)) {
    console.error(`Usage: upec-wipe reply <broker> ${REPLY_OUTCOMES.join('|')}`);
    process.exit(2);
  }
  const names = replyNames({
    targets: catalogEmailTargets(loadCatalog(undefined, () => {}), { explicitNames: new Set(brokersList.map(b => b.name.toLowerCase())) }),
    brokers: brokersList,
    state: require('../config').loadState(),
  });
  const found = findEmailTarget(names, query);
  if (found.error) { console.error(found.error); process.exit(2); }
  const replyLock = acquireStateLockOrExit();
  try {
    // Reload under the lock: a run may have written state since this process started.
    const st = require('../config').resetState();
    logReplyFor(st, found.name, outcome);
    saveState();
  } finally {
    lock.release(replyLock);
  }
  console.log(`${found.name}: reply logged as ${outcome}.`);
  process.exit(0);
}

module.exports = { run };
