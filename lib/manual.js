'use strict';
/**
 * lib/manual.js - sites waiting for the member to finish by hand.
 *
 * A run records each manual site in state (config.recordManual) under its state
 * key ("Broker" or "Broker|First Last"). These helpers read that state for
 * `upec-wipe manual` and find the keys `upec-wipe done <broker>` acts on.
 */

const lower = (s) => String(s || '').toLowerCase();

function splitKey(key) {
  const i = key.indexOf('|');
  return i === -1 ? { name: key, person: '' } : { name: key.slice(0, i), person: key.slice(i + 1) };
}

// Open manual entries, oldest first.
function manualEntries(state) {
  const optOuts = (state && state.optOuts) || {};
  return Object.entries(optOuts)
    .filter(([, e]) => e && e.manual)
    .map(([key, e]) => ({ key, ...splitKey(key), since: e.manual.since, detail: e.manual.detail || '' }))
    .sort((a, b) => String(a.since).localeCompare(String(b.since)));
}

// Every state key for a broker (one per person), or the bare name.
function keysFor(state, name) {
  const keys = Object.keys((state && state.optOuts) || {}).filter(k => k === name || k.startsWith(`${name}|`));
  return keys.length ? keys : [name];
}

// Exact name (any case), else a single partial match.
function findBroker(names, query) {
  const q = lower(query);
  const exact = names.filter(n => lower(n) === q);
  if (exact.length === 1) return { name: exact[0] };
  const hits = names.filter(n => lower(n).includes(q));
  if (hits.length === 1) return { name: hits[0] };
  if (!hits.length) return { error: `No broker or site matches "${query}". \`upec-wipe manual\` and \`upec-wipe pending\` show the names.` };
  return { error: `"${query}" matches more than one broker or site: ${hits.join(', ')}. Use the full name.` };
}

module.exports = { manualEntries, keysFor, findBroker, splitKey };
