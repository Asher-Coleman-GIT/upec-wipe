'use strict';
/**
 * lib/catalog.js
 *
 * The reviewed site catalog (data/catalog/<domain>.json). Validates records,
 * and turns reviewed ones into broker objects for one person, in the shape
 * brokers.forPerson() returns, so they run through processBroker unchanged.
 *
 * Records hold value tokens ("{firstName}"), never values: a literal is only
 * allowed when it is "on" or an option value the survey recorded for a select.
 */
const fs = require('fs');
const path = require('path');
const { hostnameOf, registrableDomain } = require('./serp-scan');
const { normalizeUsState, usStateName } = require('./us-state');
const { parseDob } = require('./dob');

const CATALOG_DIR = path.join(__dirname, '..', 'data', 'catalog');
const TOKENS = ['firstName', 'lastName', 'fullName', 'email', 'city', 'state', 'stateName', 'zip', 'dobMonthName', 'dobDay', 'dobYear'];
const IDENTITY_TOKENS = new Set(['firstName', 'lastName', 'fullName', 'email']);
const STATES = ['unreviewed', 'reviewed', 'manual', 'needs-review', 'excluded'];
const GROUPS = ['dead', 'blocked', 'business', 'people-search', 'unknown'];
const METHODS = ['direct-form', 'search-form', 'manual'];
const NOT_FILES = new Set(['candidates.json']);

function isHttps(u) { try { return new URL(String(u)).protocol === 'https:'; } catch (_) { return false; } }
function onDomain(u, domain) { const h = hostnameOf(u); return h === domain || h.endsWith(`.${domain}`); }
function tokenOf(v) { const m = /^\{(\w+)\}$/.exec(String(v)); return m ? m[1] : null; }
function urlTokens(u) { return [...String(u).matchAll(/\{(\w+)\}/g)].map(m => m[1]); }
function recordedOptions(record) {
  const out = new Set();
  for (const c of (record.survey && record.survey.controls) || []) {
    for (const o of c.options || []) out.add(String(o).split('=')[0]);
  }
  out.delete('');
  return out;
}

function validateDefinition(record, d) {
  if (!d || !METHODS.includes(d.method)) return 'reviewed record needs a definition with a known method';
  if (!d.optOutUrl) return 'definition needs optOutUrl';
  for (const k of ['optOutUrl', 'searchUrl']) {
    if (d[k] === undefined) continue;
    if (!isHttps(d[k])) return `${k} is not https`;
    if (!onDomain(d[k], record.domain)) return `${k} is not on ${record.domain}`;
    const bad = urlTokens(d[k]).find(t => !TOKENS.includes(t));
    if (bad) return `unknown token {${bad}} in ${k}`;
  }
  if (d.method === 'search-form') {
    if (!d.searchUrl) return 'search-form needs searchUrl';
    if (typeof d.listingPattern !== 'string' || !d.listingPattern) return 'search-form needs listingPattern';
    try { new RegExp(d.listingPattern); } catch (_) { return 'listingPattern does not compile'; }
  }
  if (d.method === 'manual' || d.manualAfterSearch) return null;
  const literals = recordedOptions(record);
  let identity = false;
  for (const [sel, v] of Object.entries(d.formFields || {})) {
    const t = tokenOf(v);
    if (t) {
      if (!TOKENS.includes(t)) return `unknown token {${t}} for ${sel}`;
      if (IDENTITY_TOKENS.has(t)) identity = true;
      continue;
    }
    if (v === 'on' || literals.has(String(v))) continue;
    return `literal value for ${sel} is not allowed (use a token, "on", or a recorded option value)`;
  }
  if (!identity) return 'form fills none of name or email';
  const usesDob = Object.values(d.formFields || {}).some(v => /^\{dob/.test(String(v)));
  if (usesDob && !(Array.isArray(d.requires) && d.requires.includes('dob'))) return 'form uses a birth date but does not require dob';
  return null;
}

function validateRecord(record, fileName) {
  if (!record || typeof record !== 'object') return 'not an object';
  if (typeof record.domain !== 'string' || !record.domain) return 'missing domain';
  if (fileName && fileName !== `${record.domain}.json`) return 'domain does not match the file name';
  if (typeof record.name !== 'string' || !record.name.trim()) return 'missing name';
  if (!GROUPS.includes(record.group)) return `unknown group "${record.group}"`;
  const review = record.review || { state: 'unreviewed' };
  if (!STATES.includes(review.state)) return `unknown review state "${review.state}"`;
  if (review.state === 'reviewed') return validateDefinition(record, review.definition);
  if (review.state === 'manual' && !isHttps(review.optOutUrl)) return 'manual record needs an https optOutUrl';
  if (review.state === 'needs-review') {
    const url = (review.definition && review.definition.optOutUrl) || review.optOutUrl;
    if (!isHttps(url)) return 'needs-review record needs an https optOutUrl';
  }
  return null;
}

function loadCatalog(dir = CATALOG_DIR, warn = (m) => console.warn(m)) {
  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !NOT_FILES.has(f)).sort();
  } catch (err) {
    if (err.code !== 'ENOENT') warn(`Warning: the site catalog could not be read (${err.code}); running without it.`);
    return [];
  }
  const out = [];
  for (const f of files) {
    let rec;
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) {
      warn(`Warning: catalog ${f} skipped: not valid JSON`);
      continue;
    }
    const err = validateRecord(rec, f);
    if (err) { warn(`Warning: catalog ${f} skipped: ${err}`); continue; }
    out.push(rec);
  }
  return out;
}

function personValues(person) {
  const p = person || {};
  const s = (v) => (v == null ? '' : String(v));
  const dob = parseDob(p.dob) || { year: '', monthName: '', day: '' };
  return {
    firstName: s(p.firstName), lastName: s(p.lastName),
    fullName: s(p.fullName || [p.firstName, p.lastName].filter(Boolean).join(' ')),
    email: s(p.email), city: s(p.city), zip: s(p.zip),
    state: normalizeUsState(p.state) || s(p.state), stateName: usStateName(p.state),
    dobMonthName: dob.monthName, dobDay: dob.day, dobYear: dob.year,
  };
}
function fill(v, vals, encode) {
  return String(v).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? (encode ? encodeURIComponent(vals[k]) : vals[k]) : m));
}

function coveredByExplicit(domain, explicitHosts) {
  for (const h of explicitHosts) {
    if (h === domain || h.endsWith(`.${domain}`) || domain.endsWith(`.${h}`) || registrableDomain(h) === domain) return true;
  }
  return false;
}

function catalogBrokersForPerson(records, person, { explicitHosts = new Set(), explicitNames = new Set() } = {}) {
  const vals = personValues(person);
  const out = [];
  const seen = new Set();
  for (const r of records || []) {
    if (seen.has(r.domain)) continue;
    seen.add(r.domain);
    if (coveredByExplicit(r.domain, explicitHosts) || explicitNames.has(r.name.toLowerCase())) continue;
    const rv = r.review || { state: 'unreviewed' };
    const base = { name: r.name, source: 'catalog', domain: r.domain, reviewedAt: rv.reviewedAt || null, priority: 5 };
    if (rv.state === 'manual') {
      out.push({ ...base, method: 'manual', optOutUrl: rv.optOutUrl, notes: rv.notes ? `${rv.notes}: ${rv.optOutUrl}` : rv.optOutUrl });
    } else if (rv.state === 'needs-review') {
      const url = (rv.definition && rv.definition.optOutUrl) || rv.optOutUrl;
      out.push({ ...base, method: 'manual', optOutUrl: url, notes: `needs review (${rv.note || 'the site changed'}) - do it by hand: ${url}` });
    } else if (rv.state === 'reviewed') {
      const d = rv.definition;
      const b = {
        ...base, method: d.method, optOutUrl: fill(d.optOutUrl, vals, true),
        captchaLikely: !!d.captchaLikely, usOnly: d.usOnly !== false,
        requires: Array.isArray(d.requires) ? d.requires : [],
      };
      if (d.submitSelector) b.submitSelector = d.submitSelector;
      if (d.manualAfterSearch) b.manualAfterSearch = true;
      if (d.searchUrl) b.searchUrl = fill(d.searchUrl, vals, true);
      if (d.listingPattern) b.listingPattern = new RegExp(d.listingPattern, 'i');
      if (d.formFields) b.formFields = Object.fromEntries(Object.entries(d.formFields).map(([k, v]) => [k, fill(v, vals, false)]));
      if (d.method === 'manual') b.notes = d.notes ? `${d.notes}: ${b.optOutUrl}` : b.optOutUrl;
      if (d.notes && d.method !== 'manual') b.notes = d.notes;
      out.push(b);
    }
  }
  return out;
}

function catalogDomains(records) { return new Set((records || []).map(r => r.domain)); }

function catalogSummary(records) {
  return (records || []).map(r => {
    const rv = r.review || { state: 'unreviewed' };
    return { name: r.name, domain: r.domain, state: rv.state, reviewedAt: rv.reviewedAt || null,
      optOutUrl: (rv.definition && rv.definition.optOutUrl) || rv.optOutUrl || (r.survey && r.survey.optOutUrl) || null };
  });
}

module.exports = { CATALOG_DIR, TOKENS, validateRecord, loadCatalog, catalogBrokersForPerson, catalogDomains, catalogSummary };
