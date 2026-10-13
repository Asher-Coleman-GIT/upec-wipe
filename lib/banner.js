'use strict';
/**
 * lib/banner.js - the UPEC-WIPE banner. The U is the utahupec.org logo: wifi
 * bands over a red U (#BE0000), drawn in the same block letters as PEC-WIPE.
 * Only the U is colored; the bands and the word use the terminal's own color,
 * as on the site.
 */

const RED = '\x1b[38;2;190;0;0m';
const RESET = '\x1b[0m';

const WIFI = ['', '', '▄▀▀▀▀▀▄', ' ▄▀▀▀▄', '  ▄▀▄', ''];
const U = ['█   █', '█   █', '█   █', '█   █', '█████'];
const WORD = [
  '████  █████  ████       █   █ ███ ████  █████',
  '█   █ █     █           █   █  █  █   █ █',
  '████  ████  █     ████  █ █ █  █  ████  ████',
  '█     █     █           ██ ██  █  █     █',
  '█     █████  ████       █   █ ███ █     █████',
];
const TAGLINE = '        Web Identity Purge Engine';

function renderBanner({ color = false } = {}) {
  const u = (s) => (color ? RED + s + RESET : s);
  return [
    ...WIFI,
    ...U.map((row, i) => ` ${u(row)}  ${WORD[i]}`),
    TAGLINE,
  ].join('\n');
}

// Color only on a real terminal, unless NO_COLOR is set (no-color.org: any
// non-empty value) or the terminal is "dumb".
function useColor({ isTTY = !!process.stdout.isTTY, env = process.env } = {}) {
  if (!isTTY) return false;
  if (env.NO_COLOR) return false;
  if (env.TERM === 'dumb') return false;
  return true;
}

module.exports = { renderBanner, useColor };
