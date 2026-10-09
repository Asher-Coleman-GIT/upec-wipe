'use strict';
/*
 * lib/playwright-loader.js - load Playwright's chromium from the project only.
 *
 * Audit L6: the old fallback required code from ~/.openclaw/plugins/node_modules,
 * i.e. executed whatever happened to be in the home directory. There is no
 * fallback now: if the project's own Playwright is missing, fail with an install hint.
 */

const INSTALL_HINT = 'npm ci --ignore-scripts && npx playwright install chromium';

function loadChromium(requireFn) {
  const req = requireFn || require;
  try {
    return req('playwright').chromium;
  } catch (err) {
    const e = new Error(`Playwright is not installed. Run: ${INSTALL_HINT}`);
    e.code = 'PLAYWRIGHT_MISSING';
    e.cause = err;
    throw e;
  }
}

module.exports = { loadChromium, INSTALL_HINT };
