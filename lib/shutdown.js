/**
 * lib/shutdown.js
 *
 * Signal cleanup for long-running browser sessions (main run, --confirm-emails).
 *
 * Without this, Ctrl+C or a SIGTERM from systemd kills Node immediately: the
 * throwaway browser profile (which holds broker cookies) is never deleted and
 * the state lock is left behind. installSignalCleanup awaits `cleanup` (close
 * the session, release the lock) and then exits 130 for SIGINT or 143 for
 * SIGTERM. It is idempotent: a second signal while cleanup runs does nothing.
 */

'use strict';

const EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

/**
 * @param {object} args
 * @param {() => (void|Promise<void>)} args.cleanup - awaited once; errors are swallowed
 * @param {NodeJS.EventEmitter} [args.proc] - defaults to process (tests inject a fake)
 * @param {(code: number) => void} [args.exit] - defaults to process.exit
 * @returns {{ pending: () => Promise<void>, uninstall: () => void }}
 */
function installSignalCleanup({ cleanup, proc = process, exit = (code) => process.exit(code) }) {
  let running = null;
  const handle = (signal) => {
    if (running) return;
    running = Promise.resolve()
      .then(() => cleanup())
      .catch(() => {})
      .then(() => exit(EXIT_CODES[signal]));
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
