'use strict';
/**
 * lib/catalog-survey-core.js
 *
 * Pure helpers for scripts/catalog-survey.js: grouping a surveyed page,
 * picking opt-out links to follow, fingerprinting the form, and merging a
 * survey into a catalog record without touching its review.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hostnameOf } = require('./domain');

const PEOPLE_RE = /people search|background check|public records|find people|people finder|phone lookup|reverse phone|address lookup/i;
const OPTOUT_RE = /opt.?out|do not sell|remove|suppress|privacy request|delete/i;
const DEAD_ERR_RE = /ERR_NAME_NOT_RESOLVED|ENOTFOUND|ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE/;

const hay = (c) => `${c.name} ${c.id} ${c.placeholder} ${c.aria} ${c.label}`;
const isSearchBox = (c) => /search|find|lookup/i.test(`${c.name} ${c.id} ${c.placeholder} ${c.aria}`);

function hasIdentityField(controls) {
  return (controls || []).some(c => c.tag === 'input' && !isSearchBox(c) && (c.type === 'email' || /first|last|name|e-?mail/i.test(hay(c))));
}

function hasNameSearchBox(controls) {
  return (controls || []).some(c => c.tag === 'input' && isSearchBox(c) && /name|people|person/i.test(hay(c)));
}

function classifyGroup({ status, error, blocked, title = '', text = '', controls = [] } = {}) {
  if (error && DEAD_ERR_RE.test(error)) return 'dead';
  if (status === 404 || status === 410) return 'dead';
  if (blocked) return 'blocked';
  if (error) return 'unknown';
  if (PEOPLE_RE.test(`${title} ${text}`) || hasNameSearchBox(controls)) return 'people-search';
  return 'business';
}

function sameSite(host, domain) { return host === domain || host.endsWith(`.${domain}`); }

function optOutLinks(links, baseUrl, domain) {
  const out = [];
  for (const l of links || []) {
    let u;
    try { u = new URL(l.href, baseUrl); } catch (_) { continue; }
    if (u.protocol !== 'https:' || !sameSite(u.hostname.replace(/^www\./, ''), domain)) continue;
    if (!OPTOUT_RE.test(`${l.text} ${u.pathname}`)) continue;
    u.hash = '';
    const s = u.toString();
    if (s === baseUrl || out.includes(s)) continue;
    out.push(s);
    if (out.length === 3) break;
  }
  return out;
}

function emailContacts(links, domain) {
  const out = [];
  for (const l of links || []) {
    const m = /^mailto:([^?]+)/i.exec(String(l.href || ''));
    if (!m) continue;
    const addr = decodeURIComponent(m[1]).trim().toLowerCase();
    const host = addr.split('@')[1] || '';
    if (sameSite(host, domain) && !out.includes(addr)) out.push(addr);
  }
  return out;
}

function fingerprint(controls) {
  const keys = (controls || []).map(c => [c.tag, c.type, c.name, c.id, c.placeholder].join('|')).sort();
  return crypto.createHash('sha256').update(keys.join('\n')).digest('hex');
}

// Addresses belong in contacts only. Sample addresses in placeholders and
// labels ("you@example.com") are replaced like those in page text. Em and en
// dashes from site text become hyphens: records are tracked files, and the
// house style (test/no-em-dashes.test.js) allows neither.
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const DASH_RE = /[\u2013\u2014]/g;
function redactEmails(v) {
  if (typeof v === 'string') return v.replace(EMAIL_RE, '[email]').replace(DASH_RE, '-');
  if (Array.isArray(v)) return v.map(redactEmails);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactEmails(x)]));
  return v;
}

function mergeSurvey(existing, candidate, survey) {
  const prev = existing || {};
  const review = prev.review || { state: 'unreviewed' };
  const { group, ...surveyRest } = survey || {};
  const contacts = [...new Set([...(candidate.contacts || []), ...((survey && survey.contacts) || [])])];
  return {
    domain: candidate.domain,
    name: prev.name || candidate.name,
    sources: [...new Set([...(prev.sources || []), ...(candidate.sources || [])])],
    formHosts: [...new Set([...(prev.formHosts || []), ...(candidate.formHosts || [])])],
    group: review.groupOverride || group || prev.group || 'unknown',
    survey: { ...redactEmails(surveyRest), contacts },
    review,
  };
}

function writeRecordAtomic(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${record.domain}.json`);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 1) + '\n');
  fs.renameSync(tmp, file);
  return file;
}

module.exports = { hasIdentityField, classifyGroup, optOutLinks, emailContacts, fingerprint, mergeSurvey, writeRecordAtomic, hostnameOf };
