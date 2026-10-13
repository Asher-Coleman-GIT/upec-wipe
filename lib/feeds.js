/**
 * lib/feeds.js
 *
 * Live broker-list feeds from official state registries (California + Vermont).
 *
 * Replaces reliance on the stale (Jan 2023) Markup dataset as the only coverage
 * source. The registries are public CSV exports; this module fetches them
 * (fetchImpl injectable for tests), normalizes each row to the catalog-source
 * shape { name, optOutUrl, method, source }, dedups by registrable domain
 * against the explicit brokers.js list (and against each other), and the result
 * is written by scripts/update-catalog-sources.js to data/feeds-brokers.json.
 *
 * Pure helpers (normalizeFeedRow, parseCsv, mapHeaderRow, dedupeFeedBrokers)
 * have no network or file I/O. Only fetchCaRegistry / fetchVtRegistry /
 * buildFeedsFile touch the (injected) network.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { hostnameOf } = require('./domain');
const { ensureNodeEgress } = require('./egress');

// ── Registry endpoints (real, public) ────────────────────────────────────────
// California: the CPPA data broker registry (cppa.ca.gov/data_broker_registry),
// current-year CSV. Checked 2026-10-12: 866 rows, text/csv. The old AG export
// (oag.ca.gov/data-brokers/csv) answers 403. Override via CA_REGISTRY_URL.
//
// Audit M6: registry rows decide which sites the catalog survey visits, so
// an override is honoured only when it is an https URL. Anything else prints a
// warning (naming the variable, never its value) and the default is used.
function isHttpsUrl(u) {
  try { return new URL(String(u)).protocol === 'https:'; } catch (_) { return false; }
}
function registryUrlFromEnv(varName, fallback) {
  const v = process.env[varName];
  if (v === undefined || v === '') return fallback;
  if (isHttpsUrl(v)) return v;
  console.warn(`Warning: ${varName} is not an https URL and is ignored; using the default registry.`);
  return fallback;
}

const CA_REGISTRY_URL = registryUrlFromEnv('CA_REGISTRY_URL', 'https://cppa.ca.gov/data_broker_registry/registry.csv');

// Vermont: Secretary of State data-broker registry bulk export.
// Override via VT_REGISTRY_URL (https only).
const VT_REGISTRY_URL = registryUrlFromEnv('VT_REGISTRY_URL',
  'https://bizfilings.vermont.gov/online/DatabrokerInquire/DatabrokerExport');

// Audit M6: a registry export is a few hundred KB; refuse anything over 5 MB.
const MAX_FEED_BYTES = 5 * 1024 * 1024;

const FEEDS_PATH = path.join(__dirname, '..', 'data', 'feeds-brokers.json');

// Header aliases -> canonical fields. Registries use different column titles.
const NAME_HEADERS = ['data broker name', 'business name', 'name', 'company name', 'registrant'];
// The CPPA registry (2026) has a separate column for the page where consumers
// exercise their rights; prefer it over the company's home page.
const URL_HEADERS  = [
  "data broker's primary website that contains details on how consumers can exercise their ca consumer privacy rights",
  'website url', 'website', 'url', 'opt-out url', 'opt out url', 'privacy url', 'data broker primary website',
];
const EMAIL_HEADERS = ['data broker primary contact email address', 'email address', 'email', 'contact email', 'e-mail', 'primary email address', 'privacy email'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// The broker's own site. Its privacy page can live on a shared platform
// (OneTrust and others), so the site, not that page, identifies the broker.
const WEBSITE_HEADERS = ['data broker primary website'];

// URL path keywords that indicate a directly-actionable opt-out / request page.
const DIRECT_FORM_KEYWORDS = [
  'opt-out', 'optout', 'opt_out',
  'do-not-sell', 'donotsell', 'do_not_sell',
  'privacy-request', 'privacyrequest',
  'data-request', 'datarequest',
  'dsar', 'remove', 'delete', 'request',
];

/**
 * Parse a single CSV line into an array of cell strings, honoring double-quoted
 * fields, embedded commas, and doubled-quote ("") escapes.
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/**
 * Map a header array and a cell array into a row object keyed by lowercased,
 * trimmed header names. Tolerates rows shorter than the header row.
 * @param {string[]} headers
 * @param {string[]} cells
 * @returns {Record<string,string>}
 */
function mapHeaderRow(headers, cells) {
  const row = {};
  for (let i = 0; i < headers.length; i++) {
    // CPPA titles end in ":" and may use a typographic apostrophe.
    const key = String(headers[i] || '').trim().toLowerCase().replace(/\u2019/g, "'").replace(/\s*:\s*$/, '');
    if (!key) continue;
    row[key] = cells[i] !== undefined ? cells[i] : '';
  }
  return row;
}

/**
 * Parse a CSV string into an array of header-mapped row objects. The first
 * non-empty line is treated as the header. Blank lines are skipped.
 * @param {string} csv
 * @returns {Array<Record<string,string>>}
 */
function parseCsv(csv) {
  if (!csv) return [];
  const lines = String(csv).split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    rows.push(mapHeaderRow(headers, cells));
  }
  return rows;
}

function pickField(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined && String(row[key]).trim().length > 0) {
      return String(row[key]).trim();
    }
  }
  return '';
}

function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function classifyMethod(url) {
  if (!url) return 'manual';
  // Extract the URL path only (ignore hostname/query-param values to avoid false positives).
  // A keyword must appear as a whole path segment (delimited by / or end-of-path).
  let urlPath;
  try {
    urlPath = new URL(url).pathname.toLowerCase();
  } catch (_) {
    // Fallback for scheme-less URLs: use the portion after the first /
    const slashIdx = url.indexOf('/');
    urlPath = slashIdx === -1 ? '' : url.slice(slashIdx).toLowerCase();
  }
  // Split the path into individual segments (filter empty strings from leading /)
  const segments = urlPath.split('/').filter(s => s.length > 0);
  for (const kw of DIRECT_FORM_KEYWORDS) {
    // Match whole segments or segment parts separated by - or _
    // e.g. kw="opt-out" matches segment "opt-out", "opt-out-request" etc.
    // kw="remove" must be a complete segment or a hyphen/underscore token
    for (const seg of segments) {
      // Split each segment on hyphens and underscores to get sub-tokens
      const tokens = seg.split(/[-_]/);
      // The keyword itself matches as a whole segment
      if (seg === kw) return 'direct-form';
      // Or the keyword appears as a whole hyphen/underscore-separated token within the segment
      if (tokens.includes(kw)) return 'direct-form';
      // Or the segment starts with the keyword followed by - or _
      // (handles "opt-out-request" matching "opt-out")
      if (seg.startsWith(kw + '-') || seg.startsWith(kw + '_')) return 'direct-form';
    }
  }
  return 'manual';
}

/**
 * Normalize one parsed registry row into a catalog-source entry.
 * @param {Record<string,string>} row  header-mapped row (lowercased keys)
 * @param {string} source  'ca' | 'vt'
 * @returns {{ name: string, optOutUrl: string, method: string, source: string } | null}
 */
function normalizeFeedRow(row, source) {
  if (!row || typeof row !== 'object') return null;
  const name = pickField(row, NAME_HEADERS);
  if (!name) return null;
  const optOutUrl = normalizeUrl(pickField(row, URL_HEADERS));
  const entry = { name, optOutUrl, method: classifyMethod(optOutUrl), source };
  // Kept for phase 2 (emailed requests to business brokers). Only a real
  // address is kept; registries put "n/a" or prose in this column too.
  const contact = pickField(row, EMAIL_HEADERS).toLowerCase();
  if (EMAIL_RE.test(contact)) entry.contact = contact;
  const website = normalizeUrl(pickField(row, WEBSITE_HEADERS));
  if (website) entry.website = website;
  return entry;
}

/**
 * Dedupe normalized feed brokers by registrable domain, dropping any whose
 * host collides with an explicit broker host (or with an earlier feed entry).
 * Entries with no parseable host (empty optOutUrl) are kept as-is - they are
 * manual rows that carry no dedupe key.
 * @param {Array<{name,optOutUrl,method,source}>} brokers
 * @param {Iterable<string>} explicitHosts  bare hostnames (www-stripped) from brokers.js
 * @returns {Array<{name,optOutUrl,method,source}>}
 */
function dedupeFeedBrokers(brokers, explicitHosts) {
  const seen = new Set(explicitHosts);
  const out = [];
  for (const b of brokers) {
    if (!b) continue;
    // Key on the broker's own site when known: several brokers share one
    // privacy platform host (privacyportal.onetrust.com).
    const host = hostnameOf(b.website || b.optOutUrl);
    if (!host) { out.push(b); continue; }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(b);
  }
  return out;
}

function tooLarge(url) {
  return new Error(`Feed response from ${url} is over the 5 MB limit; refusing it.`);
}

async function fetchText(url, fetchImpl) {
  const impl = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!impl) throw new Error('No fetch implementation available (Node 18+ global fetch or inject fetchImpl)');
  await ensureNodeEgress();
  const res = await impl(url);
  if (!res || !res.ok) {
    const status = res ? res.status : 'no-response';
    throw new Error(`Feed fetch failed for ${url}: HTTP ${status}`);
  }
  // Size cap (audit M6): trust a declared length first, then count while reading.
  const declared = res.headers && typeof res.headers.get === 'function'
    ? Number(res.headers.get('content-length'))
    : NaN;
  if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) throw tooLarge(url);
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FEED_BYTES) {
        try { await reader.cancel(); } catch (_) {}
        throw tooLarge(url);
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  const text = await res.text();
  if (Buffer.byteLength(String(text), 'utf8') > MAX_FEED_BYTES) throw tooLarge(url);
  return text;
}

/**
 * Normalize a registry CSV and drop every row whose URL is not https after
 * normalization (audit M6). Rows with no URL stay: they are manual entries the
 * catalog survey never visits. Only the count of dropped rows is reported,
 * never the URLs.
 * @param {string} csv
 * @param {'ca'|'vt'} source
 * @param {(msg:string) => void} [logFn]  defaults to console.warn
 * @returns {Array<{name,optOutUrl,method,source}>}
 */
function normalizeRegistryCsv(csv, source, logFn) {
  if (/^\s*</.test(String(csv))) {
    const label = source === 'ca' ? 'California' : 'Vermont';
    const envVar = source === 'ca' ? 'CA_REGISTRY_URL' : 'VT_REGISTRY_URL';
    throw new Error(`${label} registry download is a web page, not CSV: the registry may have moved. Set ${envVar} to its current CSV address.`);
  }
  const rows = parseCsv(csv).map(r => normalizeFeedRow(r, source)).filter(Boolean);
  const kept = rows.filter(r => !r.optOutUrl || isHttpsUrl(r.optOutUrl));
  const dropped = rows.length - kept.length;
  if (dropped > 0) {
    const label = source === 'ca' ? 'California' : 'Vermont';
    (logFn || console.warn)(`${label} registry: dropped ${dropped} row(s) whose URL is not https.`);
  }
  return kept;
}

/**
 * Fetch + normalize the California data-broker registry.
 * @param {{ fetchImpl?: Function, url?: string, logFn?: Function }} [opts]
 * @returns {Promise<Array<{name,optOutUrl,method,source}>>}
 */
async function fetchCaRegistry(opts = {}) {
  const url = opts.url || CA_REGISTRY_URL;
  const csv = await fetchText(url, opts.fetchImpl);
  return normalizeRegistryCsv(csv, 'ca', opts.logFn);
}

/**
 * Fetch + normalize the Vermont data-broker registry.
 * @param {{ fetchImpl?: Function, url?: string, logFn?: Function }} [opts]
 * @returns {Promise<Array<{name,optOutUrl,method,source}>>}
 */
async function fetchVtRegistry(opts = {}) {
  const url = opts.url || VT_REGISTRY_URL;
  const csv = await fetchText(url, opts.fetchImpl);
  return normalizeRegistryCsv(csv, 'vt', opts.logFn);
}

/**
 * Fetch both registries, merge, and dedupe against the explicit broker hosts.
 * Pure aside from the (injected) fetches; does NOT write to disk - callers
 * (scripts/update-catalog-sources.js) own the write.
 * @param {{ fetchImpl?: Function, explicitHosts?: Iterable<string> }} [opts]
 * @returns {Promise<{ brokers: Array, stats: { ca: number, vt: number, total: number } }>}
 */
async function buildFeedsFile(opts = {}) {
  const fetchImpl = opts.fetchImpl;
  const explicitHosts = opts.explicitHosts || [];
  // Each registry stands alone: Vermont's export has been a script-only page
  // since 2026, and that must not throw away California's rows.
  const log = opts.logFn || ((m) => console.warn(m));
  const tryFetch = async (label, fn) => {
    try { return await fn({ fetchImpl, logFn: opts.logFn }); } catch (err) {
      log(`${label} registry skipped: ${err.message}`);
      return [];
    }
  };
  const ca = await tryFetch('California', fetchCaRegistry);
  const vt = await tryFetch('Vermont', fetchVtRegistry);
  const merged = dedupeFeedBrokers([...ca, ...vt], explicitHosts);
  return {
    brokers: merged,
    stats: { ca: ca.length, vt: vt.length, total: merged.length },
  };
}

/**
 * Derive the bare (www-stripped) hostnames an explicit broker covers, from its
 * optOutUrl or searchUrl. Email-only / host-less brokers contribute nothing.
 * @param {Array<{optOutUrl?:string, searchUrl?:string}>} brokers
 * @returns {Set<string>}
 */
function explicitHostsOf(brokers) {
  const hosts = new Set();
  for (const b of brokers || []) {
    const host = hostnameOf((b && (b.optOutUrl || b.searchUrl)) || '');
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * Orchestrate `scripts/update-catalog-sources.js`: derive explicit hosts, fetch +
 * normalize + dedup both registries via buildFn, persist via writeFn, and log a
 * summary via logFn. All side-effecting deps are injected for testability.
 * @param {{
 *   brokers: Array,
 *   buildFn?: (opts:{ explicitHosts:Set<string> }) => Promise<{brokers:Array, stats:object}>,
 *   writeFn?: (brokers:Array) => void,
 *   logFn?: (msg:string) => void,
 * }} deps
 * @returns {Promise<{ brokers: Array, stats: { ca:number, vt:number, total:number } }>}
 */
async function runUpdateBrokers(deps = {}) {
  const { brokers = [] } = deps;
  const buildFn = deps.buildFn || buildFeedsFile;
  const log = deps.logFn || (() => {});
  const writeFn = deps.writeFn || ((arr) => {
    fs.writeFileSync(FEEDS_PATH, JSON.stringify(arr, null, 2));
  });
  const explicitHosts = explicitHostsOf(brokers);
  // The registry fetches are Node-direct: fail closed off the VPN (audit M7).
  await ensureNodeEgress(deps.config);
  log(`Fetching live broker registries (CA + Vermont)...`);
  const { brokers: feedBrokers, stats } = await buildFn({ explicitHosts, logFn: log });
  writeFn(feedBrokers);
  log(`Wrote ${stats.total} deduped registry broker(s) to data/feeds-brokers.json`);
  log(`  California: ${stats.ca} fetched - Vermont: ${stats.vt} fetched`);
  return { brokers: feedBrokers, stats };
}

module.exports = {
  normalizeFeedRow,
  parseCsv,
  parseCsvLine,
  mapHeaderRow,
  dedupeFeedBrokers,
  explicitHostsOf,
  fetchCaRegistry,
  fetchVtRegistry,
  normalizeRegistryCsv,
  isHttpsUrl,
  buildFeedsFile,
  runUpdateBrokers,
  CA_REGISTRY_URL,
  VT_REGISTRY_URL,
  MAX_FEED_BYTES,
  FEEDS_PATH,
};
