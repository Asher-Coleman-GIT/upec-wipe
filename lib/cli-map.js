'use strict';
/*
 * lib/cli-map.js - pure argument-to-target mapping for the `upec-wipe` CLI.
 *
 * resolveCommand(args) takes everything after `node bin/upec-wipe.js` and returns a
 * descriptor of what to spawn. It performs NO spawning, NO filesystem access,
 * and NO network - it is a pure function so it can be unit-tested directly.
 *
 * Subcommand flags are verified against watcher.js argv parsing.
 */

const path = require('path');

const PROGRAM = 'upec-wipe';

// name -> { file, flags, cwd, desc }
// flags are the watcher.js flags this subcommand injects before passthrough.
const COMMANDS = {
  setup:            { file: 'setup.js',            flags: [],                   cwd: 'root',      desc: 'Interactive first-run setup (creates config.json)' },
  doctor:           { file: 'watcher.js',          flags: ['--doctor'],         cwd: 'root',      desc: 'Self-diagnose environment and configuration' },
  preview:          { file: 'watcher.js',          flags: ['--preview'],        cwd: 'root',      desc: 'Dry-run: fill forms but submit nothing' },
  run:              { file: 'watcher.js',          flags: [],                   cwd: 'root',      desc: 'Run the opt-out pass now (--forms: web forms, the default; --email: email requests)' },
  pending:          { file: 'watcher.js',          flags: ['--pending'],        cwd: 'root',      desc: 'List brokers awaiting an email-confirmation click' },
  reply:            { file: 'watcher.js',          flags: ['--reply'],          cwd: 'root',      desc: 'Log a broker reply to an email request: upec-wipe reply <broker> honored|refused|verify|none|bounced' },
  verify:           { file: 'watcher.js',          flags: ['--verify'],         cwd: 'root',      desc: 'Re-search brokers and report whether you still appear' },
  list:             { file: 'watcher.js',          flags: ['--list'],           cwd: 'root',      desc: 'List configured brokers and their last-known status' },
  'serp-watch':     { file: 'watcher.js',          flags: ['--serp-watch'],     cwd: 'root',      desc: 'Scan and list domains where your name newly appears' },
  'catalog-check':  { file: 'scripts/catalog-survey.js', flags: ['--reviewed'], cwd: 'root',  desc: 'Re-check reviewed catalog sites and flag any whose opt-out page changed' },
  clear:            { file: 'watcher.js',          flags: ['--clear'],          cwd: 'root',      desc: 'Delete your setup (config and passphrase); keeps history' },
  'clear-all':      { file: 'watcher.js',          flags: ['--clear-all'],      cwd: 'root',      desc: 'Delete everything UPEC-WIPE saved on this machine' },
};

const HELP_FLAGS = new Set(['--help', '-h', 'help']);
const VERSION_FLAGS = new Set(['--version', '-v']);

function resolveCommand(args) {
  const list = Array.isArray(args) ? args : [];
  const first = list[0];

  if (first === undefined || HELP_FLAGS.has(first)) {
    return { ok: true, target: 'help' };
  }
  if (VERSION_FLAGS.has(first)) {
    return { ok: true, target: 'version' };
  }

  const spec = COMMANDS[first];
  if (!spec) {
    return { ok: false, target: 'help', error: `unknown command: ${first}` };
  }

  const passthrough = list.slice(1);
  return {
    ok: true,
    target: 'node',
    command: first,
    file: spec.file,
    cwd: spec.cwd,
    args: [spec.file, ...spec.flags, ...passthrough],
  };
}

/**
 * Turn a resolveCommand() descriptor into the exact spawn arguments.
 *
 * spec.file is relative to the repo root. Absolutising the script against the
 * root keeps module resolution independent of the working directory.
 *
 * @param {object} resolved  a { target: 'node', file, cwd, args } descriptor
 * @param {string} root      absolute path to the repo root
 * @returns {{ script: string, cwd: string, args: string[] }}
 */
function resolveSpawnTarget(resolved, root) {
  const script = path.resolve(root, resolved.file);
  return { script, cwd: root, args: [script, ...resolved.args.slice(1)] };
}

function buildHelp() {
  const lines = [];
  lines.push('data-broker opt-out and privacy requests');
  lines.push('');
  lines.push(`Usage: ${PROGRAM} <command> [options]`);
  lines.push('');
  lines.push('Commands:');
  const width = Math.max(...Object.keys(COMMANDS).map(k => k.length));
  for (const name of Object.keys(COMMANDS)) {
    lines.push(`  ${name.padEnd(width)}  ${COMMANDS[name].desc}`);
  }
  lines.push('');
  lines.push('Other:');
  lines.push(`  --help, -h     Show this help`);
  lines.push(`  --version, -v  Show the installed version`);
  lines.push('');
  return lines.join('\n');
}

module.exports = { PROGRAM, COMMANDS, resolveCommand, resolveSpawnTarget, buildHelp };
