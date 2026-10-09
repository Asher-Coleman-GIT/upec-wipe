'use strict';
/*
 * lib/child-env.js - environment for spawned child processes (audit L4).
 *
 * Dashboard credentials (AIDR_USER, AIDR_PASS, AIDR_TOKEN) are only needed by
 * the dashboard process itself. A child (watcher, Chromium behind it) inherits
 * the parent's environment, and same-uid processes can read it from
 * /proc/<pid>/environ, so they are removed here. AIDR_PASSPHRASE_FILE and
 * AIDR_PASSPHRASE are deliberately kept: the child needs one of them to open an
 * encrypted config, and removing them would break runs.
 */

const STRIPPED = ['AIDR_PASS', 'AIDR_USER', 'AIDR_TOKEN'];

function childEnv(base, extra) {
  const env = { ...(base || process.env) };
  for (const k of STRIPPED) delete env[k];
  return Object.assign(env, extra || {});
}

// bin/aidr.js: the dashboard child IS the process that needs the credentials
// (it generates or reads them at boot), so only non-dashboard children are stripped.
function cliChildEnv(command, base) {
  return command === 'dashboard' ? { ...(base || process.env) } : childEnv(base);
}

module.exports = { childEnv, cliChildEnv, STRIPPED };
