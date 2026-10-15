'use strict';
/**
 * lib/modes/manual.js - --manual: print the sites waiting for the member to
 * finish by hand, with the reason and link each run gave, then exit.
 * --import-last-run first loads them from the newest run log (for runs made
 * before runs recorded them).
 */
const path = require('path');
const lock = require('../lock');
const { acquireStateLockOrExit } = require('./shared');

function importLastRun() {
  const config = require('../config');
  const { importFromLog } = require('../manual');
  const { loadLastLog } = require('../filter');
  const log = loadLastLog(path.join(__dirname, '..', '..', 'logs'));
  if (!log) {
    console.log('\nNo run log found to import from.');
    return;
  }
  const importLock = acquireStateLockOrExit();
  try {
    const st = config.resetState();
    // With several people, state is keyed per person and a run log does not
    // say which person a line was for: the next run records them correctly.
    if (Object.keys(st.optOuts || {}).some(k => k.includes('|'))) {
      console.log('\nImport works for one person only. Run `upec-wipe run --assist` instead; it records every manual site.');
      return;
    }
    // Done, waiting on a confirmation, or already listed: leave it as it is.
    const skip = (key) => config.shouldSkip(key) || (st.optOuts[key] && st.optOuts[key].manual);
    const n = importFromLog(log, { keyFor: (name) => name, shouldSkip: skip, record: config.recordManual });
    console.log(`\nImported ${n} site(s) from the run of ${String(log.runAt || '').slice(0, 16).replace('T', ' ')} (UTC).`);
  } finally {
    lock.release(importLock);
  }
}

async function run({ argv = [] } = {}) {
  if (argv.includes('--import-last-run')) importLastRun();
  const { loadState, loadConfig, getPersonsFromConfig, CONFIG_PATH, CONFIG_ENC_PATH } = require('../config');
  const { manualEntries, formatManual } = require('../manual');
  const { dropPersonalQueries } = require('../redact');
  // Cards saved before 2026-10-15 can hold a link prefilled with the name.
  // No config (cleared, or a test copy): nothing to scrub for.
  const fs = require('fs');
  let persons = [];
  if (fs.existsSync(CONFIG_PATH) || fs.existsSync(CONFIG_ENC_PATH)) {
    try { persons = getPersonsFromConfig(loadConfig()); } catch (_) { persons = []; }
  }
  const scrub = (t) => dropPersonalQueries(t, persons);
  const entries = manualEntries(loadState()).map(e => ({ ...e, detail: scrub(e.detail) }));
  if (entries.length === 0) {
    console.log('\nNo sites are waiting for you to finish by hand.\n');
    return 0;
  }
  const brokers = require('../../brokers');
  const brokerNames = new Set(brokers.map(b => b.name));
  const urlFor = (name) => { const u = (brokers.find(b => b.name === name) || {}).optOutUrl; return u ? scrub(u) : null; };
  console.log(`\n${formatManual(entries, { brokerNames, urlFor })}\n`);
  return 0;
}

module.exports = { run };
