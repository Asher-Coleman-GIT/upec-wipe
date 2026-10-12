'use strict';
/**
 * lib/modes/confirm-emails.js - --confirm-emails [dir]: process .eml files and auto-click confirm links (moved from watcher.js).
 */
const { STATE_PATH, loadConfig } = require('../config');
const { loadChromium } = require('../playwright-loader');
const lock = require('../lock');
const { openBrowserSession } = require('../browser-session');
const { installSignalCleanup } = require('../shutdown');
const { acquireStateLockOrExit } = require('./shared');

// ── --confirm-emails [dir]: process .eml files and auto-click confirm links ───
async function run({ flags }) {
  const { DRY_RUN, confirmEmailsDir } = flags;
  const brokers = require('../../brokers');
  const { processConfirmationEmails, describeConfirmOutcome, summarizeConfirmResult } = require('../imap-confirm');

  // Launch a minimal headless browser context just for navigating confirm links
  let chromiumForConfirm;
  chromiumForConfirm = loadChromium();

  // Acquire the same process lock as main() - processConfirmationEmails calls
  // recordSuccess -> saveState, so it must not race a concurrent normal run.
  const CONFIRM_LOCK_PATH = STATE_PATH + '.lock';
  acquireStateLockOrExit();

  // Ctrl+C / SIGTERM: close the browser (deletes the throwaway profile) and
  // release the lock before exiting 130/143.
  let confirmClose = null;
  let confirmProfile = null; // set as soon as the profile dir exists, before launch
  installSignalCleanup({
    cleanup: async () => {
      if (confirmClose) await confirmClose();
      else if (confirmProfile) confirmProfile.cleanup();
      lock.release(CONFIRM_LOCK_PATH);
    },
    syncCleanup: () => {
      if (confirmProfile) confirmProfile.cleanup();
      try { lock.release(CONFIRM_LOCK_PATH); } catch (_) { /* best effort */ }
    },
  });

  return (async () => {
    console.log(`\nProcessing confirmation emails from: ${confirmEmailsDir}`);
    const { context, close } = await openBrowserSession({ chromium: chromiumForConfirm, config: loadConfig(), headless: true, onProfile: (p) => { confirmProfile = p; } });
    confirmClose = close;

    try {
      const result = await processConfirmationEmails(context, brokers, {
        dir: confirmEmailsDir,
        dryRun: DRY_RUN,
      });

      for (const entry of result.processed) {
        console.log(`  ${describeConfirmOutcome(entry)}: ${entry.broker.name}`);
      }
      for (const entry of result.unmatched) {
        console.log(`  unmatched (${entry.reason}): ${entry.file}`);
      }
      for (const entry of result.failed) {
        console.log(`  failed: ${entry.broker.name} -> ${entry.error}`);
      }

      console.log(`\n${summarizeConfirmResult(result)}\n`);
    } finally {
      await close();
      lock.release(CONFIRM_LOCK_PATH);
    }
    process.exit(0);
  })().catch(err => {
    lock.release(CONFIRM_LOCK_PATH);
    console.error('confirm-emails error:', err.message);
    process.exit(1);
  });
}

module.exports = { run };
