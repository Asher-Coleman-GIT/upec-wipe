'use strict';
/**
 * lib/dead-urls.js - the dead-site list (data/dead-urls.json) the catalog
 * candidate builder skips. Moved here when the generic pass was retired.
 */
const fs = require('fs');
const path = require('path');

const DEAD_URLS_PATH = path.join(__dirname, '..', 'data', 'dead-urls.json');

// ─── Dead-URL list ───────────────────────────────────────────────────────────
// A missing or malformed file is treated as an empty set.

function loadDeadSet(deadUrlsPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(deadUrlsPath, 'utf8'));
    return new Set(Array.isArray(raw.hosts) ? raw.hosts : []);
  } catch (_) {
    return new Set();
  }
}

module.exports = { DEAD_URLS_PATH, loadDeadSet };
