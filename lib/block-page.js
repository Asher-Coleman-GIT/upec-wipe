'use strict';
/**
 * lib/block-page.js
 *
 * Recognise bot-protection and block pages (Cloudflare, PerimeterX, generic
 * "are you human" checks). These never clear for an automated browser, so a
 * run must not fill them, and a search must not read them as "not listed".
 */

// Interstitials a person can clear in the browser window (--assist).
const CHALLENGE_PATTERNS = [
  /just a moment\.\.\./i,
  /performing security verification/i,
  /checking your browser/i,
  /are you human\?/i,
  /press & hold to confirm you are a human/i,
  /access to this page has been denied/i,
  /please complete the security challenge/i,
];
// Hard blocks (the site refuses this IP or ASN): no click gets through.
const HARD_BLOCK_PATTERNS = [
  /attention required!?\s*\|\s*cloudflare/i,
  /used cloudflare to restrict access/i,
  /you have been blocked/i,
];

function hayOf({ title, text } = {}) {
  return `${title || ''}\n${text || ''}`;
}

function detectBlockPage({ status, title, text } = {}) {
  const hay = hayOf({ title, text });
  if ([...CHALLENGE_PATTERNS, ...HARD_BLOCK_PATTERNS].some(re => re.test(hay))) return 'blocked by bot protection';
  if (status === 403 || status === 429) return `blocked (HTTP ${status})`;
  return null;
}

/** True when the page is a challenge a person can complete, not a hard block. */
function isSolvableChallenge({ title, text } = {}) {
  const hay = hayOf({ title, text });
  return CHALLENGE_PATTERNS.some(re => re.test(hay)) && !HARD_BLOCK_PATTERNS.some(re => re.test(hay));
}

class BlockedPageError extends Error {
  constructor(reason, { solvable = false } = {}) {
    super(reason);
    this.name = 'BlockedPageError';
    this.reason = reason;
    this.solvable = solvable;
  }
}

async function readPage(page, resp) {
  const status = resp && typeof resp.status === 'function' ? resp.status() : null;
  // Promise.resolve().then(...) also catches a synchronous throw (closed page).
  const title = await Promise.resolve().then(() => page.title()).catch(() => '');
  const text = await Promise.resolve().then(() => page.evaluate(() => (document.body ? document.body.innerText.slice(0, 2000) : ''))).catch(() => '');
  return { status, title, text };
}

async function checkPageBlocked(page, resp) {
  return detectBlockPage(await readPage(page, resp));
}

/** { reason, solvable } for a block page, or null. */
async function checkPageBlockedDetail(page, resp) {
  const seen = await readPage(page, resp);
  const reason = detectBlockPage(seen);
  return reason ? { reason, solvable: isSolvableChallenge(seen) } : null;
}

module.exports = { detectBlockPage, isSolvableChallenge, BlockedPageError, checkPageBlocked, checkPageBlockedDetail };
