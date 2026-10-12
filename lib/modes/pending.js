'use strict';
/**
 * lib/modes/pending.js - --pending: print brokers awaiting email confirmation, then exit (moved from watcher.js).
 */

// ── --pending: print brokers awaiting email confirmation, then exit ──────────
async function run() {
  const brokers = require('../../brokers');
  const { getPendingConfirmations } = require('../config');
  const pending = getPendingConfirmations(brokers);
  if (pending.length === 0) {
    console.log('\nNo brokers are currently awaiting email confirmation.\n');
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log('\n' + pad('Broker', 40) + pad('Pending since', 14) + 'Confirmation hint');
    console.log('-'.repeat(90));
    for (const p of pending) {
      const since = p.since.slice(0, 10);
      const hint = p.expectedSender || (p.snippet ? p.snippet.slice(0, 40) : '(check your inbox)');
      console.log(pad(p.name, 40) + pad(since, 14) + hint);
    }
    console.log(`\n${pending.length} broker(s) awaiting confirmation. Check your inbox for opt-out confirmation emails.\n`);
  }
  process.exit(0);
}

module.exports = { run };
