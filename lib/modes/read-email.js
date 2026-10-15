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
  const { loadCatalog, catalogEmailTargets } = require('../catalog');
  const { registrableDomain, hostnameOf } = require('../domain');
  const brokersList = require('../../brokers');

  const targets = [
    ...catalogEmailTargets(loadCatalog(undefined, () => {}), { explicitNames: new Set(brokersList.map(b => b.name.toLowerCase())) })
      .map(t => ({ name: t.name, to: t.to, domain: t.domain })),
    ...brokersList.filter(b => b.method === 'email' && b.emailTo)
      .map(b => ({ name: b.name, to: String(b.emailTo).toLowerCase(), domain: registrableDomain(hostnameOf(b.optOutUrl || `https://${String(b.emailTo).split('@')[1]}`)) })),
  ];

  const code = await readEmail({ since: flags.SINCE_ARG }, {
    config: loadConfig(),
    state: loadState(),
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
