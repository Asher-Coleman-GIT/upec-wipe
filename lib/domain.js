'use strict';
/**
 * lib/domain.js
 *
 * Hostname helpers shared by the runners, the catalog and the SERP scan.
 * registrableDomain keeps the last two labels, or three under the two-label
 * suffixes in BARE_SUFFIXES (co.uk and the like). It is not the full public
 * suffix list.
 */

// Two-label public suffixes: a registrable domain under them keeps three labels.
const BARE_SUFFIXES = new Set(['co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'co.za', 'com.br', 'co.jp']);

/**
 * Extract the bare hostname from a URL, stripping the www. prefix.
 *
 * @param {string} url
 * @returns {string}  hostname without www., or '' on parse error
 */
function hostnameOf(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

/**
 * Reduce a hostname to its registrable domain: the last two labels, or the
 * last three under a suffix in BARE_SUFFIXES.
 * e.g. 'privacy.spokeo.com' -> 'spokeo.com'
 *      'www.broker.co.uk'   -> 'broker.co.uk'
 *
 * @param {string} hostname
 * @returns {string}
 */
function registrableDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.split('.');
  if (parts.length >= 3 && BARE_SUFFIXES.has(parts.slice(-2).join('.'))) return parts.slice(-3).join('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

module.exports = { hostnameOf, registrableDomain, BARE_SUFFIXES };
