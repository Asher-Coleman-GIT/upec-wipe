'use strict';
/**
 * lib/modes/done.js - --done <broker>: mark a site finished by hand (or its
 * confirmation link clicked). Clears its manual and pending entries and starts
 * the re-check window, as a successful run would, then exits.
 */
const lock = require('../lock');
const { acquireStateLockOrExit } = require('./shared');

async function run({ argv }) {
  const { query, extra } = require('../cli-flags').doneArgs(argv);
  if (!query || extra) {
    console.error('Usage: upec-wipe done <broker>   (quote a name with spaces: upec-wipe done "Truth Now")');
    return 2;
  }
  const { findBroker, keysFor, splitKey } = require('../manual');
  const config = require('../config');
  const doneLock = acquireStateLockOrExit();
  try {
    // Reload under the lock: a run may have written state since this process started.
    const st = config.resetState();
    const names = new Set(require('../../brokers').map(b => b.name));
    for (const key of Object.keys(st.optOuts || {})) names.add(splitKey(key).name);
    const found = findBroker([...names], query);
    if (found.error) {
      console.error(found.error);
      return 2;
    }
    for (const key of keysFor(st, found.name)) config.recordSuccess(key, 'done by hand');
    console.log(`${found.name}: marked done. Runs skip it for ${config.RECHECK_DAYS} days, then check it again.`);
    return 0;
  } finally {
    lock.release(doneLock);
  }
}

module.exports = { run };
