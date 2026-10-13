'use strict';
/**
 * lib/modes/update-brokers.js - --update-brokers: refresh data/feeds-brokers.json from live registries (moved from watcher.js).
 */
const fs = require('fs');
const { loadConfig, configErrorReason } = require('../config');
const { setEgressConfig } = require('../egress');

// ── --update-brokers: refresh data/feeds-brokers.json from live registries ──
// Pure HTTP + file write; no Playwright, no loadConfig. Fetches the California
// + Vermont data-broker registries, normalizes, dedups against brokers.js, and
// writes the feed file consumed by generic-runner.js. Markup data remains the
// fallback. Async, so this lives as a peer of --doctor (not a standalone
// pre-ladder block) to avoid falling through into the normal Playwright run.
async function run() {
  const brokers = require('../../brokers');
  const { runUpdateBrokers } = require('../feeds');
  // The egress gate needs network.required / network.proxy. With no readable
  // config it falls back to {} and requires Mullvad (fail closed).
  let updateCfg = {};
  try {
    const { CONFIG_PATH, CONFIG_ENC_PATH } = require('../config');
    if (fs.existsSync(CONFIG_PATH) || fs.existsSync(CONFIG_ENC_PATH)) updateCfg = loadConfig();
  } catch (err) {
    // Say so: network.required / network.proxy from the config do not apply.
    const reason = configErrorReason(err);
    console.warn(`Warning: config could not be read (${reason}); using network defaults (Mullvad check required).`);
    updateCfg = {};
  }
  setEgressConfig(updateCfg);
  return runUpdateBrokers({ brokers, logFn: (m) => console.log(m), config: updateCfg })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('update-brokers error:', err.message);
      process.exit(1);
    });
}

module.exports = { run };
