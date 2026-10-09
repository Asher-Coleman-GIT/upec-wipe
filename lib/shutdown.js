/**
 * lib/shutdown.js
 *
 * Signal cleanup for long-running browser sessions (main run, --confirm-emails).
 *
 * Without this, Ctrl+C or a SIGTERM from systemd kills Node immediately: the
 * throwaway browser profile (which holds broker cookies) is never deleted and
 * the state lock is left behind. installSignalCleanup awaits `cleanup` (close
 * the session, release the lock) and then exits 130 for SIGINT or 143 for
 * SIGTERM. Cleanup runs once; a second signal while it runs removes the
 * profile synchronously and exits at once, and a cleanup that hangs past
 * timeoutMs gets the same synchronous fallback.
 */

'use strict';

const EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

/**
 * @param {object} args
 * @param {() => (void|Promise<void>)} args.cleanup - awaited once; errors are swallowed
 * @param {() => void} [args.syncCleanup] - best-effort synchronous fallback (remove the
 *   ephemeral profile dir). Runs on a second signal and when cleanup times out.
 * @param {number} [args.timeoutMs] - cleanup budget before the fallback runs (default 10000)
 * @param {NodeJS.EventEmitter} [args.proc] - defaults to process (tests inject a fake)
 * @param {(code: number) => void} [args.exit] - defaults to process.exit
 * @returns {{ pending: () => Promise<void>, uninstall: () => void }}
 */
function installSignalCleanup({
  cleanup,
  syncCleanup = () => {},
  timeoutMs = 10000,
  proc = process,
  exit = (code) => process.exit(code),
}) {
  let running = null;
  let exiting = false;
  const safeSync = () => { try { syncCleanup(); } catch (_) { /* best effort */ } };
  const handle = (signal) => {
    const code = EXIT_CODES[signal];
    if (exiting) return;
    if (running) {
      // Second signal: the operator wants out now.
      exiting = true;
      safeSync();
      exit(code);
      return;
    }
    running = new Promise((resolve) => {
      const timer = setTimeout(() => { safeSync(); resolve(); }, timeoutMs);
      Promise.resolve()
        .then(() => cleanup())
        .catch(() => {})
        .then(() => { clearTimeout(timer); resolve(); });
    }).then(() => {
      if (exiting) return;
      exiting = true;
      exit(code);
    });
  };
  const onInt = () => handle('SIGINT');
  const onTerm = () => handle('SIGTERM');
  proc.on('SIGINT', onInt);
  proc.on('SIGTERM', onTerm);
  return {
    pending: () => running || Promise.resolve(),
    uninstall: () => {
      proc.removeListener('SIGINT', onInt);
      proc.removeListener('SIGTERM', onTerm);
    },
  };
}

module.exports = { installSignalCleanup, EXIT_CODES };
