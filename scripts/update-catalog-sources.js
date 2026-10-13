#!/usr/bin/env node
// scripts/update-catalog-sources.js - refresh data/feeds-brokers.json from the
// California and Vermont data-broker registries (was `upec-wipe update-brokers`).
//
//   node scripts/update-catalog-sources.js
//
// HTTP only, no browser, through the Mullvad check. scripts/catalog-candidates.js
// reads the file with the bundled Markup and BADBOOL lists.
'use strict';
process.umask(0o077);
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

async function main(deps = {}) {
  const config = require(path.join(ROOT, 'lib/config'));
  const {
    loadConfig = config.loadConfig,
    configExists = () => fs.existsSync(config.CONFIG_PATH) || fs.existsSync(config.CONFIG_ENC_PATH),
    setEgressConfig = require(path.join(ROOT, 'lib/egress')).setEgressConfig,
    runUpdateBrokers = require(path.join(ROOT, 'lib/feeds')).runUpdateBrokers,
    log = (m) => console.log(m),
    warn = (m) => console.warn(m),
  } = deps;
  // The egress gate needs network.required / network.proxy. With no readable
  // config it falls back to {} and requires Mullvad (fail closed).
  let cfg = {};
  try {
    if (configExists()) cfg = loadConfig();
  } catch (err) {
    warn(`Warning: config could not be read (${config.configErrorReason(err)}); using network defaults (Mullvad check required).`);
    cfg = {};
  }
  setEgressConfig(cfg);
  try {
    await runUpdateBrokers({ brokers: require(path.join(ROOT, 'brokers')), logFn: log, config: cfg });
    return 0;
  } catch (err) {
    console.error('update-catalog-sources error:', err.message);
    return 1;
  }
}

if (require.main === module) {
  require(path.join(ROOT, 'lib/privilege')).exitIfRoot();
  main().then((code) => process.exit(code));
}

module.exports = { main };
