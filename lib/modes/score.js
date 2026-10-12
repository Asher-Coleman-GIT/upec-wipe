'use strict';
/**
 * lib/modes/score.js - --score: print the exposure score + breakdown + trend, then exit (moved from watcher.js).
 */
const { loadState } = require('../config');

// ── --score: print the exposure score + breakdown + trend, then exit ─────────
// Read-only: no browser, no forms submitted. Reads state.json and the
// persisted SERP history; persists a dated snapshot to data/exposure-history.json.
async function run({ flags }) {
  const { DRY_RUN } = flags;
  const brokers = require('../../brokers');
  const state   = loadState();
  const {
    computeExposureScore,
    serpResultsFromHistory,
    loadExposureHistory,
    snapshotExposure,
    formatScoreReport,
  } = require('../exposure');

  // Reconstruct the SERP signal from persisted history (no live scan).
  const serpResults = serpResultsFromHistory(require('../serp-scan').readHistory());

  // breachCount defaults to 0 until HIBP integration lands.
  const summary = computeExposureScore({ state, serpResults, breachCount: 0, brokers });

  const priorHistory = loadExposureHistory();
  console.log('\n' + formatScoreReport(summary, priorHistory));
  // Persist this run's snapshot (skipped in dry-run to honor that contract).
  if (!DRY_RUN) snapshotExposure(summary);
  console.log('');
  process.exit(0);
}

module.exports = { run };
