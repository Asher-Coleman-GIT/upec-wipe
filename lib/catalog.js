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
const { BARE_SUFFIXES } = require('./catalog-sources');

const CATALOG_DIR = path.join(__dirname, '..', 'data', 'catalog');
const TOKENS = ['firstName', 'lastName', 'fullName', 'email', 'city', 'state', 'stateName', 'zip', 'dobMonthName', 'dobDay', 'dobYear'];
const IDENTITY_TOKENS = new Set(['firstName', 'lastName', 'fullName', 'email']);
const STATES = ['unreviewed', 'reviewed', 'manual', 'needs-review', 'excluded', 'email'];
const GROUPS = ['dead', 'blocked', 'business', 'people-search', 'unknown'];
const METHODS = ['direct-form', 'search-form', 'manual'];
const NOT_FILES = new Set(['candidates.json']);

// Query parameters that carry identity must take a token, never a value.
const PERSONAL_PARAM_RE = /^(first|last|fname|lname|firstname|lastname|first_name|last_name|name|fullname|full_name|q|query|email|e|city|state|st|zip|zipcode|postal|dob|birth|birthdate|phone|address|addr|street)$/i;

function isHttps(u) { try { return new URL(String(u)).protocol === 'https:'; } catch (_) { return false; } }
// On the record's own domain, or on a form host the candidate list recorded
// for it (a shared privacy platform such as onetrust.com). Nothing else.
function onDomain(u, record) {
  const h = hostnameOf(u).replace(/\.$/, '');
  if (h === record.domain || h.endsWith(`.${record.domain}`)) return true;
  return Array.isArray(record.formHosts) && record.formHosts.includes(registrableDomain(h));
}
function goodDomain(d) {
  return typeof d === 'string' && d.includes('.') && registrableDomain(d) === d && !BARE_SUFFIXES.has(d);
}
function urlProblem(u, k) {
  if (/\{email\}/.test(String(u))) return `the email token is not allowed in a URL (${k}): the real email never goes into a request`;
  let parsed;
  try { parsed = new URL(String(u)); } catch (_) { return `${k} is not a URL`; }
  for (const [name, value] of parsed.searchParams) {
    if (PERSONAL_PARAM_RE.test(name) && value !== '' && !/^\{\w+\}$/.test(value)) return `query parameter "${name}" in ${k} must be a token`;
  }
  return null;
}
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
    if (!onDomain(d[k], record)) return `${k} is not on ${record.domain}`;
    const bad = urlTokens(d[k]).find(t => !TOKENS.includes(t));
    if (bad) return `unknown token {${bad}} in ${k}`;
    const up = urlProblem(d[k], k);
    if (up) return up;
  }
  if (d.method === 'search-form') {
    if (!d.searchUrl) return 'search-form needs searchUrl';
    if (typeof d.listingPattern !== 'string' || !d.listingPattern) return 'search-form needs listingPattern';
    try { new RegExp(d.listingPattern); } catch (_) { return 'listingPattern does not compile'; }
  }
  // Values are checked whatever the method: a manual record never submits
  // them, but it is still a tracked file that must hold no personal data.
  const formOnly = d.method !== 'manual' && !d.manualAfterSearch;
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
  if (formOnly && !identity) return 'form fills none of name or email';
  const usesDob = Object.values(d.formFields || {}).some(v => /^\{dob/.test(String(v)));
  if (usesDob && !(Array.isArray(d.requires) && d.requires.includes('dob'))) return 'form uses a birth date but does not require dob';
  return null;
}

// Phase 2: a broker that takes requests by email. The address must be one the
// survey recorded, so no address is ever typed into a record by hand.
const BASIS_KINDS = ['utah', 'all-us'];
const ANY_EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
function validateEmailReview(record, review) {
  const contacts = ((record.survey && record.survey.contacts) || []).map(c => String(c).toLowerCase());
  if (typeof review.to !== 'string' || !contacts.includes(review.to.toLowerCase())) return 'email record needs a "to" taken from survey.contacts';
  const b = review.basis || {};
  if (!BASIS_KINDS.includes(b.kind)) return 'basis.kind must be "utah" or "all-us"';
  if (typeof b.quote !== 'string' || !b.quote.trim() || b.quote.length > 400) return 'basis.quote must be 1-400 characters';
  if (ANY_EMAIL_RE.test(b.quote)) return 'basis.quote may not contain an email address';
  if (!isHttps(b.url)) return 'basis.url is not https';
  if (!onDomain(b.url, record)) return `basis.url is not on ${record.domain}`;
  return null;
}

function validateRecord(record, fileName) {
  if (!record || typeof record !== 'object') return 'not an object';
  if (typeof record.domain !== 'string' || !record.domain) return 'missing domain';
  if (!goodDomain(record.domain)) return `domain "${record.domain}" is not a registrable site domain`;
  if (record.formHosts !== undefined && !(Array.isArray(record.formHosts) && record.formHosts.every(goodDomain))) return 'formHosts must be registrable site domains';
  if (fileName && fileName !== `${record.domain}.json`) return 'domain does not match the file name';
  if (typeof record.name !== 'string' || !record.name.trim()) return 'missing name';
  if (!GROUPS.includes(record.group)) return `unknown group "${record.group}"`;
  const review = record.review || { state: 'unreviewed' };
  if (!STATES.includes(review.state)) return `unknown review state "${review.state}"`;
  if (review.state === 'reviewed') return validateDefinition(record, review.definition);
  if (review.state === 'email') return validateEmailReview(record, review);
  if (review.state === 'manual') {
    if (!isHttps(review.optOutUrl)) return 'manual record needs an https optOutUrl';
    if (!onDomain(review.optOutUrl, record)) return `optOutUrl is not on ${record.domain}`;
  }
  if (review.state === 'needs-review') {
    const url = (review.definition && review.definition.optOutUrl) || review.optOutUrl;
    if (!isHttps(url)) return 'needs-review record needs an https optOutUrl';
    if (!onDomain(url, record)) return `optOutUrl is not on ${record.domain}`;
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

// Registry names carry legal suffixes and commas ("33Across, Inc."), which
// --only/--skip split on. The record keeps the legal name; runs use this.
const LEGAL_SUFFIX_RE = /,?\s*\b(incorporated|inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|lp|llp|plc|pbc|gmbh)\b\.?/gi;
function displayName(name, domain) {
  const n = String(name).replace(LEGAL_SUFFIX_RE, '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  return n || domain;
}

function catalogBrokersForPerson(records, person, { explicitHosts = new Set(), explicitNames = new Set() } = {}) {
  const vals = personValues(person);
  const out = [];
  const seen = new Set();
  for (const r of records || []) {
    if (seen.has(r.domain)) continue;
    seen.add(r.domain);
    if (coveredByExplicit(r.domain, explicitHosts)) continue;
    const rv = r.review || { state: 'unreviewed' };
    const base = { name: displayName(r.name, r.domain), source: 'catalog', domain: r.domain, formHosts: r.formHosts || [], reviewedAt: rv.reviewedAt || null, priority: 5 };
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
  // Names are state keys: two brokers with one name would share a 90-day
  // skip. A repeated name, or one an explicit broker uses, gets its domain.
  const count = new Map();
  for (const b of out) count.set(b.name.toLowerCase(), (count.get(b.name.toLowerCase()) || 0) + 1);
  for (const b of out) {
    const k = b.name.toLowerCase();
    if (count.get(k) > 1 || explicitNames.has(k)) b.name = `${b.name} (${b.domain})`;
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

function catalogEmailTargets(records, { explicitNames = new Set() } = {}) {
  const out = [];
  const seen = new Set();
  for (const r of records || []) {
    const rv = r.review || {};
    if (rv.state !== 'email' || seen.has(r.domain)) continue;
    seen.add(r.domain);
    out.push({ name: displayName(r.name, r.domain), domain: r.domain, to: rv.to.toLowerCase(), basis: rv.basis });
  }
  const count = new Map();
  for (const t of out) count.set(t.name.toLowerCase(), (count.get(t.name.toLowerCase()) || 0) + 1);
  for (const t of out) {
    const k = t.name.toLowerCase();
    if (count.get(k) > 1 || explicitNames.has(k)) t.name = `${t.name} (${t.domain})`;
  }
  return out;
}

module.exports = { CATALOG_DIR, TOKENS, validateRecord, loadCatalog, catalogBrokersForPerson, catalogDomains, catalogSummary, catalogEmailTargets };
