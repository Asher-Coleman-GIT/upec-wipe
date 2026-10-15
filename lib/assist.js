'use strict';
/**
 * lib/assist.js
 *
 * --assist: a bot-protection challenge ("Just a moment...", "Press & Hold")
 * never clears for automation, but a person can usually click through it in
 * the visible browser window. This waits for the member to do that, polling
 * the page, then hands control back to the normal fill/submit flow.
 */

const { checkPageBlockedDetail } = require('./block-page');

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;

/**
 * @param {object} page  Playwright page showing the challenge
 * @param {{ brokerName: string, timeoutMs?: number, pollMs?: number, prompt?: string,
 *   check?: Function, sleep?: Function, now?: Function, log?: Function }} opts
 * @returns {Promise<boolean>} true once the page is no longer a block page
 */
async function waitForHumanCheck(page, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs || DEFAULT_POLL_MS;
  const check = opts.check || ((p) => checkPageBlockedDetail(p, null));
  const sleep = opts.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const now = opts.now || Date.now;
  const log = opts.log || ((s) => console.log(s));

  await Promise.resolve().then(() => page.bringToFront()).catch(() => {});
  const prompt = opts.prompt || 'complete the check in the browser window';
  log(`\n     ${opts.brokerName}: ${prompt} (waiting up to ${Math.round(timeoutMs / 60000)} min)...`);

  const deadline = now() + timeoutMs;
  for (;;) {
    const blocked = await check(page);
    if (!blocked) {
      log('     check cleared - continuing');
      // Cloudflare reloads or redirects the page right after the check
      // passes. Let that finish, or the next goto collides with it
      // ("navigation is interrupted by another navigation").
      await Promise.resolve().then(() => page.waitForLoadState('load', { timeout: 15000 })).catch(() => {});
      return true;
    }
    // A challenge can turn into a hard block (the site refused the IP); no
    // amount of waiting fixes that.
    if (!blocked.solvable) return false;
    if (now() >= deadline) return false;
    await sleep(pollMs);
  }
}

module.exports = { waitForHumanCheck, DEFAULT_TIMEOUT_MS };
