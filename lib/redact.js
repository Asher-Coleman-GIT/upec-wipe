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

/**
 * Links on manual cards: drop a query string that carries one of the
 * persons' details (CheckPeople's opt-out link was prefilled with the
 * member's name, 2026-10-15). Paths stay: a listing link is what the member
 * opens to act on it.
 */
function dropPersonalQueries(text, persons) {
  const values = [];
  for (const p of persons || []) {
    for (const k of ['fullName', 'firstName', 'lastName', 'email', 'city', 'zip', 'phone', 'dob']) {
      const v = p && typeof p[k] === 'string' ? p[k].trim().toLowerCase() : '';
      if (v.length >= 2) values.push(v);
    }
  }
  if (!values.length) return String(text == null ? '' : text);
  return String(text == null ? '' : text).replace(/(https?:\/\/[^\s"'<>?#]+)\?([^\s"'<>#]*)/gi, (m, base, query) => {
    let q;
    try { q = decodeURIComponent(query.replace(/\+/g, ' ')).toLowerCase(); } catch (_) { q = query.toLowerCase(); }
    return values.some(v => q.includes(v)) ? base : m;
  });
}

module.exports = { redactUrl, redactUrlsInText, dropPersonalQueries };
