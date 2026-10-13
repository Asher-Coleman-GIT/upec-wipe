'use strict';
/*
 * lib/child-env.js - environment for spawned child processes (audit L4).
 *
 * UPEC_WIPE_USER, UPEC_WIPE_PASS and UPEC_WIPE_TOKEN were credentials for the
 * removed dashboard; an old shell may still export them. A child (watcher,
 * Chromium behind it) inherits the parent's environment, and same-uid
 * processes can read it from /proc/<pid>/environ, so they are removed here. UPEC_WIPE_PASSPHRASE_FILE and
 * UPEC_WIPE_PASSPHRASE are deliberately kept: the child needs one of them to open an
 * encrypted config, and removing them would break runs.
 */

const STRIPPED = ['UPEC_WIPE_PASS', 'UPEC_WIPE_USER', 'UPEC_WIPE_TOKEN'];

function childEnv(base, extra) {
  const env = { ...(base || process.env) };
  for (const k of STRIPPED) delete env[k];
  return Object.assign(env, extra || {});
}

// bin/upec-wipe.js: every child is stripped.
function cliChildEnv(_command, base) {
  return childEnv(base);
}

module.exports = { childEnv, cliChildEnv, STRIPPED };
