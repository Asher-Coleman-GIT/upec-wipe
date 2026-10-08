/**
 * lib/notify.js
 *
 * Opens manual-action URLs in the local browser. Notifications were removed in
 * this fork: nothing about a run leaves the machine.
 *
 * Public API:
 *   openInBrowser(urls) - opens URLs in the default browser (cross-platform)
 */

'use strict';

const cp = require('child_process');

function openInBrowser(urls, _platform) {
  const platform = _platform || process.platform;
  for (const url of urls) {
    try {
      let cmd, args;
      if (platform === 'darwin') {
        cmd = 'open';
        args = [url];
      } else if (platform === 'linux') {
        cmd = 'xdg-open';
        args = [url];
      } else {
        // win32: needs empty title argument before the URL
        cmd = 'cmd';
        args = ['/c', 'start', '', url];
      }
      const proc = cp.spawn(cmd, args, { detached: true, stdio: 'ignore' });
      proc.unref();
    } catch (_) {}
  }
}

module.exports = { openInBrowser };
