/**
 * lib/notify.js
 *
 * Opens manual-action URLs in the local browser. Notifications were removed in
 * this fork: nothing about a run leaves the machine.
 *
 * Public API:
 *   openInBrowser(urls) - opens safe http(s) URLs in the default browser (cross-platform)
 *   isSafeUrl(u)        - true for a plain http(s) URL with no shell metacharacters
 */

'use strict';

const cp = require('child_process');

// Characters a shell (cmd.exe in particular) or a quoting layer could act on.
// Checked on the raw string, before any URL normalisation.
const UNSAFE_URL_CHARS = /[\s&|^<>"`']/;

/**
 * True when `u` is a plain http(s) URL with no whitespace, shell
 * metacharacters or quotes. Anything else is never handed to a process
 * (audit M4: page-supplied DSAR links and registry rows reach this path).
 *
 * @param {*} u
 * @returns {boolean}
 */
function isSafeUrl(u) {
  if (typeof u !== 'string' || u === '') return false;
  if (UNSAFE_URL_CHARS.test(u)) return false;
  let parsed;
  try { parsed = new URL(u); } catch (_) { return false; }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function hostOf(u) {
  try { return new URL(String(u)).host || '(no host)'; } catch (_) { return '(unparseable)'; }
}

function openInBrowser(urls, _platform) {
  const platform = _platform || process.platform;
  for (const url of urls) {
    if (!isSafeUrl(url)) {
      // Host only: the path or query can carry personal data or a payload.
      console.warn(`  not opened: unsafe URL (${hostOf(url)})`);
      continue;
    }
    try {
      let cmd, args;
      if (platform === 'darwin') {
        cmd = 'open';
        args = [url];
      } else if (platform === 'linux') {
        cmd = 'xdg-open';
        args = [url];
      } else {
        // win32: no shell. cmd /c start interprets & | ^ in the URL.
        cmd = 'rundll32';
        args = ['url.dll,FileProtocolHandler', url];
      }
      const proc = cp.spawn(cmd, args, { detached: true, stdio: 'ignore' });
      // A missing opener (no xdg-open under WSL) is reported asynchronously;
      // without a listener it crashes the run after the summary.
      proc.on('error', () => console.warn(`  could not open a browser (${cmd} is not available) - open the ${hostOf(url)} link from the summary yourself`));
      proc.unref();
    } catch (_) {}
  }
}

module.exports = { openInBrowser, isSafeUrl };
