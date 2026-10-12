'use strict';
/**
 * lib/modes/list.js - --list: print all brokers + status from state.json, then exit (moved from watcher.js).
 */
const { loadState } = require('../config');

// ── --list: print all brokers + status from state.json, then exit ────────────
async function run() {
  const brokers = require('../../brokers');
  const state   = loadState();
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('Broker', 40) + pad('Status', 18) + 'Last opt-out');
  console.log('-'.repeat(80));
  for (const b of brokers) {
    const entry = state.optOuts && state.optOuts[b.name];
    const status = entry ? (entry.lastSuccess ? 'success' : 'pending') : 'never run';
    const last   = entry && entry.lastSuccess ? entry.lastSuccess.slice(0, 10) : '-';
    console.log(pad(b.name, 40) + pad(status, 18) + last);
  }
  const { loadCatalog, catalogSummary, catalogEmailTargets } = require('../catalog');
  const catalogRecords = loadCatalog();
  const catalog = catalogSummary(catalogRecords);
  if (catalog.length) {
    console.log(`\nCatalog sites (${catalog.length})`);
    console.log('-'.repeat(80));
    for (const c of catalog) {
      const entry = state.optOuts && state.optOuts[c.name];
      const last = entry && entry.lastSuccess ? entry.lastSuccess.slice(0, 10) : '-';
      console.log(pad(c.name, 40) + pad(c.state + (c.reviewedAt ? ` ${c.reviewedAt}` : ''), 28) + last);
    }
  }
  const emailNames = [
    ...catalogEmailTargets(catalogRecords, { explicitNames: new Set(brokers.map(b => b.name.toLowerCase())) }).map(t => t.name),
    ...brokers.filter(b => b.method === 'email').map(b => b.name),
  ];
  if (emailNames.length) {
    console.log(`\nEmail requests (${emailNames.length})`);
    console.log('-'.repeat(80));
    const { emailStatus } = require('../email-step');
    for (const n of emailNames) {
      const { status, reply } = emailStatus(state, n);
      console.log(pad(n, 40) + pad(status, 18) + (reply || '-'));
    }
  }
  console.log('');
  process.exit(0);
}

module.exports = { run };
