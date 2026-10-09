'use strict';
/*
 * lib/redact.js - keep URL paths and queries (which can carry a person's name
 * or a one-time token) out of persisted logs. Audit L11.
 */

/** Origin only (scheme://host[:port]); '[unparseable-url]' when it is not a URL. */
function redactUrl(url) {
  try { return new URL(String(url)).origin; } catch (_) { return '[unparseable-url]'; }
}

/** Replace every http(s) URL inside free text with its origin. */
function redactUrlsInText(text) {
  return String(text == null ? '' : text).replace(/https?:\/\/[^\s"'<>)]+/gi, (m) => redactUrl(m));
}

module.exports = { redactUrl, redactUrlsInText };
