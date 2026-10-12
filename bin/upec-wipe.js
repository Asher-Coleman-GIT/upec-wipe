#!/usr/bin/env node
'use strict';
// Audit M2: everything this process creates (run logs, audit files, snapshots,
// complaints, reports, config rewrites) is owner-only, however it was launched.
process.umask(0o077);
/*
 * bin/upec-wipe.js - friendly CLI dispatcher for upec-wipe.
 *
 * Maps subcommands (setup, run, preview, verify, dashboard, score, report,
 * doctor) to the existing entrypoints via lib/cli-map.js, then spawns them.
 * The dashboard subcommand generates one-time credentials so the local web UI
 * is never unauthenticated, and prints the URL + login once.
 *
 * Usage: upec-wipe <command> [options]   (run `upec-wipe --help` for the full list)
 */

const path = require('path');
const { spawn } = require('child_process');
const { resolveCommand, resolveSpawnTarget, buildHelp } = require('../lib/cli-map');
const { cliChildEnv } = require('../lib/child-env');
const { generateDashboardCreds } = require('../lib/dashboard-creds');

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
  let onSpawn = null;

  if (resolved.command === 'dashboard') {
    // Boot the dashboard authenticated. server.js reads UPEC_WIPE_USER/UPEC_WIPE_PASS
    // (see dashboard/server.js) and refuses to start if no credentials are set,
    // so generate a one-time pair when the caller did not supply one.
    if (!env.UPEC_WIPE_USER || !env.UPEC_WIPE_PASS) {
      const creds = generateDashboardCreds();
      env.UPEC_WIPE_USER = creds.user;
      env.UPEC_WIPE_PASS = creds.pass;
      const host = env.UPEC_WIPE_HOST || '127.0.0.1';
      const port = env.UPEC_WIPE_PORT || '8080';
      onSpawn = () => {
        process.stdout.write('\n  Dashboard starting...\n');
        process.stdout.write(`  URL:      http://${host}:${port}\n`);
        process.stdout.write(`  Username: ${creds.user}\n`);
        process.stdout.write(`  Password: ${creds.pass}\n`);
        process.stdout.write('  (these credentials are shown once; re-run to get new ones)\n\n');
      };
    }
  }

  const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (onSpawn) child.on('spawn', onSpawn);
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
