/**
 * lib/privilege.js
 *
 * Refuse to run as root. Run under a dedicated unprivileged user or in the
 * Docker image (which uses pwuser).
 */

'use strict';

function rootRefusal(uid) {
  if (uid !== 0) return null;
  return 'Refusing to run as root. Create an unprivileged user (or use the Docker image) and run as that user.';
}

function exitIfRoot(proc) {
  const p = proc || process;
  const uid = typeof p.getuid === 'function' ? p.getuid() : undefined;
  const msg = rootRefusal(uid);
  if (msg) {
    p.stderr.write(msg + '\n');
    p.exit(1);
  }
}

module.exports = { rootRefusal, exitIfRoot };
