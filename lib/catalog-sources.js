'use strict';
/**
 * lib/catalog-sources.js
 *
 * Read the generic-site sources (The Markup, BADBOOL, the CA and VT registry
 * feed) into one row shape, and merge them into catalog candidates: one per
 * registrable domain, minus the 32 explicit brokers and known-dead hosts.
 */
const fs = require('fs');
const { hostnameOf, registrableDomain } = require('./serp-scan');

// Two-label public suffixes: merging on them would join unrelated sites.
const BARE_SUFFIXES = new Set(['co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'co.za', 'com.br', 'co.jp']);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
const isWeb = (u) => /^https?:\/\//i.test(String(u || ''));

function markupRows(file) {
  const rows = readJson(file);
  if (!Array.isArray(rows)) return [];
  return rows.filter(r => r && isWeb(r.urlFinal)).map(r => ({ name: r.name || hostnameOf(r.urlFinal), url: r.urlFinal, source: 'markup' }));
}

function badboolRows(file) {
  const rows = readJson(file);
  if (!Array.isArray(rows)) return [];
  return rows.filter(isWeb).map(url => ({ name: hostnameOf(url), url, source: 'badbool' }));
}

function feedRows(file) {
  const rows = readJson(file);
  if (!Array.isArray(rows)) return [];
  return rows.filter(r => r && isWeb(r.optOutUrl)).map(r => {
    const row = { name: r.name, url: r.optOutUrl, source: `${r.source}-registry` };
    if (r.contact) row.contact = r.contact;
    return row;
  });
}

function buildCandidates({ rows, explicitHosts = new Set(), deadHosts = new Set() }) {
  const explicitDomains = new Set([...explicitHosts].map(h => registrableDomain(h)));
  const byDomain = new Map();
  for (const r of rows || []) {
    const url = String(r.url).replace(/^http:\/\//i, 'https://');
    // A fully qualified host can end in "." ("aboutads.info."); drop it.
    const host = hostnameOf(url).replace(/\.$/, '');
    // Registry rows sometimes hold a word ("GLBA") where the website goes.
    if (!host || !host.includes('.')) continue;
    const domain = registrableDomain(host);
    if (BARE_SUFFIXES.has(domain)) continue;
    if (explicitDomains.has(domain) || deadHosts.has(host) || deadHosts.has(domain)) continue;
    const c = byDomain.get(domain) || { domain, name: r.name || domain, urls: [], sources: [], contacts: [] };
    if (!c.urls.includes(url)) c.urls.push(url);
    if (!c.sources.includes(r.source)) c.sources.push(r.source);
    if (r.contact && !c.contacts.includes(r.contact)) c.contacts.push(r.contact);
    byDomain.set(domain, c);
  }
  return [...byDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

module.exports = { markupRows, badboolRows, feedRows, buildCandidates };
