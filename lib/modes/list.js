'use strict';
/**
 * lib/modes/list.js - --list: print all brokers + status from state.json, then exit (moved from watcher.js).
 */
const fs = require('fs');
const { loadState, loadConfig, getPersonsFromConfig, CONFIG_PATH, CONFIG_ENC_PATH } = require('../config');
const { brokerRows } = require('../list-status');

// The member's state decides which states-limited brokers apply. Without a
// readable config, every broker is shown.
function memberPersons() {
  if (!fs.existsSync(CONFIG_PATH) && !fs.existsSync(CONFIG_ENC_PATH)) return [];
  try { return getPersonsFromConfig(loadConfig()); } catch (_) { return []; }
}

// ── --list: print all brokers + status from state.json, then exit ────────────
async function run() {
  const brokers = require('../../brokers');
  const state   = loadState();
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('Broker', 40) + pad('Status', 18) + 'Date');
  console.log('-'.repeat(80));
  for (const r of brokerRows(brokers, state, memberPersons())) {
    console.log(pad(r.name, 40) + pad(r.status, 18) + r.date);
  }
  const { loadCatalog, catalogSummary, actionableCatalog, catalogEmailTargets } = require('../catalog');
  const catalogRecords = loadCatalog();
  const { shown, hiddenLine } = actionableCatalog(catalogSummary(catalogRecords));
  if (shown.length || hiddenLine) {
    console.log(`\nCatalog sites (${shown.length})`);
    console.log('-'.repeat(80));
    for (const c of shown) {
      const entry = state.optOuts && state.optOuts[c.name];
      const last = entry && entry.lastSuccess ? entry.lastSuccess.slice(0, 10) : '-';
      console.log(pad(c.name, 40) + pad(c.state + (c.reviewedAt ? ` ${c.reviewedAt}` : ''), 28) + last);
    }
    if (hiddenLine) console.log(hiddenLine);
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
