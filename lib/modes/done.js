'use strict';
/**
 * lib/modes/done.js - --done <broker> [...]: mark sites finished by hand (or
 * their confirmation links clicked). Clears their manual and pending entries
 * and starts the re-check window, as a successful run would, then exits.
 * Every name is resolved first; one unknown name changes nothing.
 */
const lock = require('../lock');
const { acquireStateLockOrExit } = require('./shared');

async function run({ argv }) {
  const { queries } = require('../cli-flags').doneArgs(argv);
  if (!queries.length) {
    console.error('Usage: upec-wipe done <broker> [<broker> ...]   (quote names with spaces: upec-wipe done "Truth Now" WhitePages)');
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
    const found = queries.map(q => findBroker([...names], q));
    const errors = found.filter(f => f.error).map(f => f.error);
    if (errors.length) {
      for (const e of errors) console.error(e);
      console.error('Nothing was marked done.');
      return 2;
    }
    for (const name of new Set(found.map(f => f.name))) {
      for (const key of keysFor(st, name)) config.recordSuccess(key, 'done by hand');
      console.log(`${name}: marked done. Runs skip it for ${config.RECHECK_DAYS} days, then check it again.`);
    }
    return 0;
  } finally {
    lock.release(doneLock);
  }
}

module.exports = { run };
