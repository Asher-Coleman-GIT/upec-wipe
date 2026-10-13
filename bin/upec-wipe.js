#!/usr/bin/env node
'use strict';
// Audit M2: everything this process creates (run logs, audit files, snapshots,
// complaints, reports, config rewrites) is owner-only, however it was launched.
process.umask(0o077);
/*
 * bin/upec-wipe.js - friendly CLI dispatcher for upec-wipe.
 *
 * Maps subcommands (setup, run, preview, verify, reply, doctor and the rest) to
 * the existing entrypoints via lib/cli-map.js, then spawns them. Retired
 * subcommands refuse with one line.
 *
 * Usage: upec-wipe <command> [options]   (run `upec-wipe --help` for the full list)
 */

const path = require('path');
const { spawn } = require('child_process');
const { resolveCommand, resolveSpawnTarget, buildHelp } = require('../lib/cli-map');
const { cliChildEnv } = require('../lib/child-env');

const ROOT = path.resolve(__dirname, '..');

function printHelp() {
  process.stdout.write(buildHelp() + '\n');
}

function printVersion() {
  const pkg = require('../package.json');
  process.stdout.write(`${pkg.name} v${pkg.version} (node ${process.version})\n`);
}

function spawnNode(resolved) {
  const { cwd, args } = resolveSpawnTarget(resolved, ROOT);
  const env = cliChildEnv(resolved.command, process.env);
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (signal) { process.exit(1); }
    process.exit(code === null ? 1 : code);
  });
  child.on('error', err => {
    process.stderr.write(`upec-wipe: failed to start ${resolved.file}: ${err.message}\n`);
    process.exit(1);
  });
}

function main() {
  const args = process.argv.slice(2);
  // Retired subcommands refuse with the same reasons watcher.js gives.
  const REMOVED_COMMANDS = {
    know: 'it cited California law (CCPA) for every non-EU member. See docs/REFERENCE.md.',
    'know-status': 'it cited California law (CCPA) for every non-EU member. See docs/REFERENCE.md.',
    complaints: 'it cited California law (CCPA) for every non-EU member. See docs/REFERENCE.md.',
    breach: 'it sent your real email to Have I Been Pwned. See docs/REFERENCE.md.',
    score: 'the exposure score depended on the breach check. See docs/REFERENCE.md.',
    report: 'the exposure score depended on the breach check. See docs/REFERENCE.md.',
    freeze: 'the freeze checklist is in docs/UPEC-MANUAL.md.',
    serp: 'use upec-wipe serp-watch.',
    dashboard: 'use the CLI; see docs/REFERENCE.md.', // removed: the local web dashboard
  };
  if (args[0] === 'update-brokers') {
    process.stderr.write('update-brokers moved: run node scripts/update-catalog-sources.js.\n');
    process.exit(1);
  }
  if (Object.prototype.hasOwnProperty.call(REMOVED_COMMANDS, args[0])) {
    process.stderr.write(`${args[0]} was removed: ${REMOVED_COMMANDS[args[0]]}\n`);
    process.exit(1);
  }
  const resolved = resolveCommand(args);

  if (resolved.target === 'help') {
    if (!resolved.ok && resolved.error) {
      process.stderr.write(`upec-wipe: ${resolved.error}\n\n`);
      printHelp();
      process.exit(2);
    }
    printHelp();
    process.exit(0);
  }
  if (resolved.target === 'version') {
    printVersion();
    process.exit(0);
  }
  spawnNode(resolved);
}

main();
