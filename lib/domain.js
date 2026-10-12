'use strict';
/**
 * lib/domain.js
 *
 * Hostname helpers shared by the runners, the catalog and the SERP scan.
 * registrableDomain keeps the last two labels; it does not know multi-part
 * suffixes such as co.uk.
 */

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
 * Reduce a hostname to its registrable domain (last two labels).
 * e.g. 'privacy.spokeo.com' -> 'spokeo.com'
 *      'spokeo.com'         -> 'spokeo.com'
 *
 * @param {string} hostname
 * @returns {string}
 */
function registrableDomain(hostname) {
  if (!hostname) return '';
  const parts = hostname.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

module.exports = { hostnameOf, registrableDomain };
