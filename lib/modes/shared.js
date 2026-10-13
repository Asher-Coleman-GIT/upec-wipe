'use strict';
/**
 * lib/modes/shared.js
 *
 * Helpers more than one mode uses (moved from watcher.js).
 */
const { STATE_PATH, loadConfig, loadState, setDryRun, getPersonsFromConfig } = require('../config');
const lock = require('../lock');
const { PREVIEW_ALIAS } = require('../relay');
const { setEgressConfig, ensureNodeEgress } = require('../egress');

// Printed once when a preview/dry-run person has no cached alias yet.
const PREVIEW_ALIAS_NOTE = `Note: no SimpleLogin alias exists yet, so this preview or dry run uses ${PREVIEW_ALIAS} as a stand-in. A real run creates the alias.`;

// One process at a time writes state.json. Exits 1 naming the holder's pid.
function acquireStateLockOrExit() {
  const lockPath = STATE_PATH + '.lock';
  try {
    lock.acquire(lockPath);
  } catch (err) {
    const pidMatch = err.message.match(/pid (\d+)/);
    console.error(`Another instance is running, pid=${pidMatch ? pidMatch[1] : '?'}. Exiting.`);
    process.exit(1);
  }
  return lockPath;
}

// One line of input from the terminal. Resolves '' when input ends (a closed
// stdin), so a prompt can never hang the process.
function askLine(question, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input, output });
    let answered = false;
    rl.question(question, a => { answered = true; rl.close(); resolve(a); });
    rl.on('close', () => { if (!answered) resolve(''); });
  });
}

// Terminal, transport and gate wiring shared by the --email and --know steps.
function emailStepIo() {
  const nodemailer = require('nodemailer');
  const { smtpTransportOptions } = require('../email');
  return {
    isTTY: !!process.stdin.isTTY,
    ask: askLine,
    log: (l) => console.log(l),
    makeTransport: (smtp) => nodemailer.createTransport(smtpTransportOptions(smtp)),
    ensureEgress: (cfg) => ensureNodeEgress(cfg, { fresh: true }),
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  };
}

// What the know and run modes share before they start: the dry-run switch,
// the config (also handed to the Node egress gate), the state and the persons.
function loadRunSetup(flags) {
  setDryRun(flags.DRY_RUN); // makes recordSuccess/saveState no-op-on-disk in dry-run
  const config = loadConfig();
  setEgressConfig(config);
  if (config.notify) console.log('Note: notify settings in config.json are ignored in this fork.');
  const state = loadState();
  const persons = getPersonsFromConfig(config);
  return { config, state, persons };
}

// The line watcher.js prints when a mode ends in an error. UPEC_WIPE_DEBUG adds
// the stack (file paths and line numbers only).
function formatFatal(err, env = process.env) {
  const line = `\nFatal: ${err && err.message}`;
  return env.UPEC_WIPE_DEBUG && err && err.stack ? `${line}\n${err.stack}` : line;
}

module.exports = { PREVIEW_ALIAS_NOTE, acquireStateLockOrExit, askLine, emailStepIo, loadRunSetup, formatFatal };
