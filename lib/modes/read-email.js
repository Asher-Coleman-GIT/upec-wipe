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
  const { loadConfig, loadState } = require('../config');
  const { ensureNodeEgress } = require('../egress');
  const { openMailbox } = require('../imap');
  const { parseMessage } = require('../mime');
  const { readEmail } = require('../read-email');
  const { logReplyFor } = require('../email-step');
  const { loadCatalog } = require('../catalog');
  const { emailedTargets } = require('../read-email');
  const brokersList = require('../../brokers');

  const state = loadState();
  const targets = emailedTargets({ catalogRecords: loadCatalog(undefined, () => {}), brokers: brokersList, state });

  const code = await readEmail({ since: flags.SINCE_ARG }, {
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
      // Reload under the lock: a run may have written state since this started.
      const replyLock = acquireStateLockOrExit();
      try {
        const st = require('../config').resetState();
        logReplyFor(st, name, outcome);
        saveState();
      } finally {
        lock.release(replyLock);
      }
      console.log(`      ${name}: reply logged as ${outcome}.`);
    },
  });
  process.exit(code);
}

module.exports = { run };
