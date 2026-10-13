'use strict';
/**
 * lib/modes/complaints.js - --complaints: regulator complaints for brokers past the legal response window (moved from watcher.js).
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { loadConfig, loadState, getPersonsFromConfig } = require('../config');
const { loadChromium } = require('../playwright-loader');
const { openBrowserSession } = require('../browser-session');

// ── --complaints: generate regulator complaints for brokers past the legal
//    response window (CCPA 45d / GDPR 30d) and write text + PDF to logs/. ─────
async function run({ flags }) {
  const { DRY_RUN } = flags;
  const brokers = require('../../brokers');
  const { findOverdue, buildComplaintsForBroker, writeComplaintFiles } = require('../complaint');

  const config  = loadConfig();
  const state   = loadState();
  const persons = getPersonsFromConfig(config);
  const brokerMap = new Map(brokers.map(b => [b.name, b]));
  // Resolve the complaint's complainant back to the person named in the
  // composite state key (B2); fall back to the first person for bare keys.
  const personByName = new Map(
    persons
      .filter(p => p && (p.firstName || p.lastName))
      .map(p => [`${p.firstName || ''} ${p.lastName || ''}`.trim(), p])
  );

  const overdueList = findOverdue(state, { persons });
  if (overdueList.length === 0) {
    console.log('\nNo brokers are past their legal response window. Nothing to escalate.\n');
    process.exit(0);
  }

  const outDir = path.join(ROOT, 'logs', 'complaints');
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('Broker', 32) + pad('Regime', 8) + pad('Days overdue', 14) + 'Requested');
  console.log('-'.repeat(78));

  const entries = overdueList.map(overdue => {
    const broker = brokerMap.get(overdue.broker) || { name: overdue.broker };
    const person = (overdue.person && personByName.get(overdue.person)) || persons[0];
    console.log(
      pad(overdue.broker, 32) +
      pad(overdue.regime, 8) +
      pad(String(overdue.daysOverdue), 14) +
      String(overdue.requestedAt).slice(0, 10)
    );
    return { broker: overdue.broker, complaints: buildComplaintsForBroker({ person, broker, overdue }) };
  });

  return (async () => {
    let newPage;
    let context;
    let session = null;
    if (!DRY_RUN) {
      let chromiumForPdf;
      chromiumForPdf = loadChromium();
      session = await openBrowserSession({ chromium: chromiumForPdf, config, headless: true, needsNetwork: false });
      context = session.context;
      newPage = () => context.newPage();
    } else {
      console.log('\nDRY RUN - writing complaint text only, skipping PDF generation.');
    }

    try {
      const { written } = await writeComplaintFiles({ outDir, entries, newPage });
      console.log(`\nWrote ${written.length} complaint file(s) to ${outDir}`);
      const pdfCount = written.filter(p => p.endsWith('.pdf')).length;
      const txtCount = written.filter(p => p.endsWith('.txt')).length;
      console.log(`   ${txtCount} text, ${pdfCount} PDF\n`);
    } finally {
      if (session) await session.close();
    }
    process.exit(0);
  })().catch(err => {
    console.error('complaints error:', err.message);
    process.exit(1);
  });
}

module.exports = { run };
