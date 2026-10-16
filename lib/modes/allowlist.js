'use strict';
/**
 * lib/modes/allowlist.js - --allow / --unallow <name>: edit config.json allowlist, then exit (moved from watcher.js).
 */
const fs = require('fs');
const { configErrorReason } = require('../config');
const { addToAllowlist, removeFromAllowlist } = require('../allowlist-edit');

// ── --allow / --unallow <name>: edit config.json allowlist, then exit ────────
async function run({ flags }) {
  const _allowlistCmd = flags.ALLOWLIST_CMD;
  const { CONFIG_PATH, writeFileFsync } = require('../config');
  if (_allowlistCmd.error || !_allowlistCmd.name) {
    console.error(`Error: ${_allowlistCmd.action === 'unallow' ? '--unallow' : '--allow'} requires a broker name, e.g. --${_allowlistCmd.action} Spokeo`);
    process.exit(1);
  }
  // Runs read the encrypted config; editing plain config.json beside it (or the
  // envelope's outer JSON) changed nothing and the broker was still opted out.
  if (require('../config').isConfigEncrypted()) {
    console.error('Error: your config is encrypted, so --allow/--unallow cannot edit it.');
    console.error('Run node watcher.js --decrypt-config, repeat this command, then node watcher.js --encrypt-config.');
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`Error: could not read config.json: ${configErrorReason(err)}`);
    process.exit(1);
  }
  const next = _allowlistCmd.action === 'allow'
    ? addToAllowlist(cfg, _allowlistCmd.name)
    : removeFromAllowlist(cfg, _allowlistCmd.name);
  // Atomic 0600 write: tmp (opened 0600) -> fsync -> rename -> chmod 0600.
  // config.json holds the legal name, address and every key (audit M2).
  writeFileFsync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n');
  const verb = _allowlistCmd.action === 'allow' ? 'Added to' : 'Removed from';
  console.log(`\n${verb} allowlist: ${_allowlistCmd.name}`);
  console.log(`   Allowlist now: ${(next.allowlist || []).join(', ') || '(empty)'}\n`);
  process.exit(0);
}

module.exports = { run };
