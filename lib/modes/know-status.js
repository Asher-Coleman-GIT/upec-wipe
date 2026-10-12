'use strict';
/**
 * lib/modes/know-status.js - --know-status: print right-to-know requests older than 45 days, then exit (moved from watcher.js).
 */

// -- --know-status: print right-to-know requests older than 45 days, then exit -
async function run() {
  const brokers = require('../../brokers');
  const { getPendingKnowRequests } = require('../config');
  const pending = getPendingKnowRequests(brokers, { olderThanDays: 45 });
  if (pending.length === 0) {
    console.log('\nNo right-to-know requests are older than 45 days awaiting a response.\n');
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log('\n' + pad('Broker', 40) + pad('Requested', 14) + 'Days ago');
    console.log('-'.repeat(70));
    for (const p of pending) {
      const when = p.knowRequestedAt.slice(0, 10);
      console.log(pad(p.name, 40) + pad(when, 14) + Math.round(p.daysAgo));
    }
    console.log(`\n${pending.length} right-to-know request(s) past 45 days. Follow up with the broker if no disclosure arrived.\n`);
  }
  process.exit(0);
}

module.exports = { run };
