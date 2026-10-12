'use strict';
/**
 * lib/modes/breach.js - --breach-check: query Have I Been Pwned for configured emails, then exit (moved from watcher.js).
 */
const { loadConfig, getPersonsFromConfig } = require('../config');
const { setEgressConfig } = require('../egress');
const { askLine } = require('./shared');

// ── --breach-check: query Have I Been Pwned for configured emails, then exit ─
async function run() {
  const brokers = require('../../brokers');
  const {
    collectEmails,
    missingKeyMessage,
    runBreachCheck,
    formatBreachReport,
    confirmBreachCheck,
  } = require('../hibp');

  const cfg     = loadConfig();
  setEgressConfig(cfg);
  const persons = getPersonsFromConfig(cfg);
  const emails  = collectEmails(persons);
  const apiKey  = cfg.hibp && cfg.hibp.apiKey;

  if (!apiKey) {
    console.log('\n' + missingKeyMessage() + '\n');
    process.exit(0);
  }

  if (emails.length === 0) {
    console.log('\nNo email addresses found in config.json. Add an "email" to your person(s) first.\n');
    process.exit(0);
  }

  return (async () => {
    const ok = await confirmBreachCheck({ emails, isTTY: !!process.stdin.isTTY, ask: askLine, log: (l) => console.log(l) });
    if (!ok) process.exit(1);
    console.log(`\nChecking ${emails.length} email(s) against Have I Been Pwned...`);
    const result = await runBreachCheck({ emails, apiKey, brokers, config: cfg });
    console.log('\n' + formatBreachReport(result) + '\n');
    process.exit(0);
  })().catch(err => {
    console.error('breach-check error:', err.message);
    process.exit(1);
  });
}

module.exports = { run };
