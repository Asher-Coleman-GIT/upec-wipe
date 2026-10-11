'use strict';
/**
 * lib/block-page.js
 *
 * Recognise bot-protection and block pages (Cloudflare, PerimeterX, generic
 * "are you human" checks). These never clear for an automated browser, so a
 * run must not fill them, and a search must not read them as "not listed".
 */

const PATTERNS = [
  /just a moment\.\.\./i,
  /attention required!?\s*\|\s*cloudflare/i,
  /used cloudflare to restrict access/i,
  /you have been blocked/i,
  /performing security verification/i,
  /checking your browser/i,
  /are you human\?/i,
  /press & hold to confirm you are a human/i,
  /access to this page has been denied/i,
  /please complete the security challenge/i,
];

function detectBlockPage({ status, title, text } = {}) {
  const hay = `${title || ''}\n${text || ''}`;
  if (PATTERNS.some(re => re.test(hay))) return 'blocked by bot protection';
  if (status === 403 || status === 429) return `blocked (HTTP ${status})`;
  return null;
}

class BlockedPageError extends Error {
  constructor(reason) { super(reason); this.name = 'BlockedPageError'; this.reason = reason; }
}

async function checkPageBlocked(page, resp) {
  const status = resp && typeof resp.status === 'function' ? resp.status() : null;
  // Promise.resolve().then(...) also catches a synchronous throw (closed page).
  const title = await Promise.resolve().then(() => page.title()).catch(() => '');
  const text = await Promise.resolve().then(() => page.evaluate(() => (document.body ? document.body.innerText.slice(0, 2000) : ''))).catch(() => '');
  return detectBlockPage({ status, title, text });
}

module.exports = { detectBlockPage, BlockedPageError, checkPageBlocked };
