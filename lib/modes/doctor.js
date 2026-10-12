'use strict';
/**
 * lib/modes/doctor.js - --doctor: self-diagnose and exit (moved from watcher.js).
 */

// ── --doctor: self-diagnose and exit ─────────────────────────────────────────
async function run() {
  const { runDoctor } = require('../doctor');
  return runDoctor().then(results => {
    process.exit(results.exitCode);
  }).catch(err => {
    console.error('doctor error:', err.message);
    process.exit(1);
  });
}

module.exports = { run };
