'use strict';
/**
 * lib/modes/breach.js - --breach-check: query Have I Been Pwned for configured emails, then exit (moved from watcher.js).
 */
const { loadConfig, getPersonsFromConfig } = require('../config');
const { setEgressConfig } = require('../egress');
const { askLine } = require('./shared');
const {
  collectEmails,
  missingKeyMessage,
  runBreachCheck,
  formatBreachReport,
  confirmBreachCheck,
} = require('../hibp');

// The part after the setup checks. deps are injectable so the order (ask,
// then check) can be tested without HIBP or a terminal.
async function breachFlow({ emails, apiKey, brokers, config }, deps = {}) {
  const d = {
    confirmBreachCheck, runBreachCheck, formatBreachReport,
    ask: askLine,
    isTTY: () => !!process.stdin.isTTY,
    log: (l) => console.log(l),
    ...deps,
  };
  const ok = await d.confirmBreachCheck({ emails, isTTY: d.isTTY(), ask: d.ask, log: d.log });
  if (!ok) return 1;
  d.log(`\nChecking ${emails.length} email(s) against Have I Been Pwned...`);
  const result = await d.runBreachCheck({ emails, apiKey, brokers, config });
  d.log('\n' + d.formatBreachReport(result) + '\n');
  return 0;
}

// ── --breach-check: query Have I Been Pwned for configured emails, then exit ─
async function run() {
  const brokers = require('../../brokers');

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

  try {
    return await breachFlow({ emails, apiKey, brokers, config: cfg });
  } catch (err) {
    console.error('breach-check error:', err.message);
    return 1;
  }
}

module.exports = { run, breachFlow };
