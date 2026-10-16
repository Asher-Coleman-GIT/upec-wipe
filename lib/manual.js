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

// Every state key for a broker (one per person). With none yet, `fallback`:
// the keys a run would use (one per person when several are configured).
function keysFor(state, name, fallback = [name]) {
  const keys = Object.keys((state && state.optOuts) || {}).filter(k => k === name || k.startsWith(`${name}|`));
  return keys.length ? keys : fallback;
}

// Exact name (any case), else a single partial match.
function findBroker(names, query) {
  const q = lower(query);
  const exact = names.filter(n => lower(n) === q);
  if (exact.length === 1) return { name: exact[0] };
  // A legal name ("Adstra LLC") finds the short name runs use ("Adstra").
  const s = lower(require('./catalog').displayName(query, query));
  const short = names.filter(n => lower(n) === s);
  if (short.length === 1) return { name: short[0] };
  const hits = names.filter(n => lower(n).includes(s));
  if (hits.length === 1) return { name: hits[0] };
  if (!hits.length) return { error: `No broker or site matches "${query}". \`upec-wipe manual\` and \`upec-wipe pending\` show the names.` };
  return { error: `"${query}" matches more than one broker or site: ${hits.join(', ')}. Use the full name.` };
}

// Load the manual and CAPTCHA-failed sites of a run log (logs/run-*.json) into
// state, for runs made before the run recorded them itself. A site that is
// done or waiting on a confirmation (shouldSkip) is left out. Returns the
// number recorded.
function importFromLog(log, { keyFor, shouldSkip, record }) {
  if (!log) return 0;
  const since = log.runAt || new Date().toISOString();
  const seen = new Set();
  let n = 0;
  const rows = [
    ...(log.manual || []).map(e => ({ name: e.broker, detail: e.detail || '' })),
    ...(log.captchaFailed || []).map(e => ({ name: e.broker, detail: `the CAPTCHA could not be solved - do it by hand: ${e.detail || ''}` })),
  ];
  for (const { name, detail } of rows) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const key = keyFor(name);
    if (shouldSkip(key)) continue;
    record(key, detail, since);
    n++;
  }
  return n;
}

// ─── Display ─────────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s)]+/g;

/**
 * A run's hand-off text, split for display: the instructions without their
 * links, and each link on its own. One link in mid-sentence reads "the link
 * below"; a trailing one is dropped with its lead-in (": ", " - ", " at ").
 * Two or more different links are labelled "link 1", "link 2".
 */
function splitDetail(detail) {
  const raw = String(detail || '').trim();
  if (!raw) return { text: '(no link recorded)', links: [] };
  const found = [];
  for (const m of raw.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:]+$/, '');
    if (!found.includes(url)) found.push(url);
  }
  const labelled = found.length > 1;
  const label = (url) => (labelled ? `link ${found.indexOf(url) + 1}` : 'the link below');
  let text = '';
  let pos = 0;
  for (const m of raw.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:]+$/, '');
    const end = m.index + url.length;
    const before = raw.slice(pos, m.index);
    const trailing = /^[.,;:]?\s*$/.test(raw.slice(end));
    text += (!labelled && trailing) ? before.replace(/\s*(?:[:-]|\bat)\s*$/, '') : before + label(url);
    pos = end;
  }
  text += raw.slice(pos);
  text = text.replace(/\s+/g, ' ').trim().replace(/\s*[:-]\s*$/, '');
  if (text) {
    text = text[0].toUpperCase() + text.slice(1);
    if (!/[.!?]\)?$/.test(text)) text += '.';
  }
  const links = labelled ? found.map((u, i) => `link ${i + 1}: ${u}`) : found;
  return { text, links };
}

// Greedy word wrap; a word longer than the line (a link) is never broken.
function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The `upec-wipe manual` listing: numbered cards, brokers first then catalog
 * sites (as `list` groups them), the listed date once per group when every
 * card shares it. `urlFor(name)` gives a link for a card whose text has none.
 */
function formatManual(entries, { brokerNames = new Set(), urlFor = () => null, width = Math.min(process.stdout.columns || 80, 100) } = {}) {
  const day = (e) => String(e.since || '').slice(0, 10);
  const groups = [
    ['Brokers', entries.filter(e => brokerNames.has(e.name))],
    ['Catalog sites', entries.filter(e => !brokerNames.has(e.name))],
  ].filter(([, list]) => list.length);
  const total = entries.length;
  const numWidth = String(total).length;
  const out = [`${total} site${total === 1 ? '' : 's'} to finish by hand`, ''];
  let n = 0;
  for (const [title, list] of groups) {
    const days = [...new Set(list.map(day))];
    const shared = days.length === 1 && days[0] ? days[0] : null;
    out.push(`${title} (${list.length})${shared ? ` - listed ${shared}` : ''}`, '-'.repeat(width));
    for (const e of list) {
      const num = `${String(++n).padStart(numWidth)}. `;
      const indent = ' '.repeat(num.length);
      out.push(`${num}${e.name}${e.person ? ` (${e.person})` : ''}${shared || !day(e) ? '' : ` - listed ${day(e)}`}`);
      const { text, links } = splitDetail(e.detail);
      // Some notes carry no link: fall back to the broker's opt-out page.
      if (!links.length && urlFor(e.name)) links.push(urlFor(e.name));
      for (const l of text ? wrap(text, width - indent.length) : []) out.push(indent + l);
      for (const l of links) out.push(indent + l);
      out.push('');
    }
  }
  out.push('When you finish one: upec-wipe done "<name>" (several names at once work too)');
  return out.join('\n');
}

module.exports = { manualEntries, keysFor, findBroker, splitKey, importFromLog, splitDetail, formatManual };
