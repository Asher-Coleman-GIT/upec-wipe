'use strict';
/**
 * lib/modes/read-email.js - --read-email [--since YYYY-MM-DD]: read the replies
 * to the email requests (read-only), suggest an outcome per broker and log the
 * ones the member confirms. The logic is lib/read-email.js.
 */
const { saveState } = require('../config');
const lock = require('../lock');
const { acquireStateLockOrExit, askLine } = require('./shared');

async function run({ flags }) {
  const { loadConfig, resetState } = require('../config');
  const { ensureNodeEgress } = require('../egress');
  const { openMailbox } = require('../imap');
  const { parseMessage } = require('../mime');
  const { readEmail } = require('../read-email');
  const { logReplyFor } = require('../email-step');
  const { loadCatalog } = require('../catalog');
  const { emailedTargets } = require('../read-email');
  const brokersList = require('../../brokers');

  // One lock for the whole session, taken before the mailbox is opened: taken
  // per logged reply, it exited mid-session while a run held it.
  const readLock = acquireStateLockOrExit();
  let code;
  try {
    // Reload under the lock: a run may have written state since startup.
    const state = resetState();
    const targets = emailedTargets({ catalogRecords: loadCatalog(undefined, () => {}), brokers: brokersList, state });

    code = await readEmail({ since: flags.SINCE_ARG }, {
      config: loadConfig(),
      state,
      targets,
      ensureEgress: (cfg) => ensureNodeEgress(cfg, { fresh: true }),
      openMailbox,
      parseMessage,
      isTTY: !!(process.stdin.isTTY && process.stdout.isTTY),
      ask: askLine,
      log: (l) => console.log(l),
      logReply: (name, outcome) => {
        logReplyFor(state, name, outcome);
        saveState();
        console.log(`      ${name}: reply logged as ${outcome}.`);
      },
    });
  } finally {
    lock.release(readLock);
  }
  process.exit(code);
}

module.exports = { run };
