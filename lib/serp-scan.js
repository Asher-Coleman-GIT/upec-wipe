/**
 * lib/serp-scan.js
 *
 * Search-engine self-scan: checks whether data broker sites appear in
 * DuckDuckGo and Google results for a person's name + location.
 *
 * Reviewed live 2026-10-15 (dummy person): html.duckduckgo.com answers 403
 * with an empty page, Bing serves unrelated results to this browser, and
 * Google's result links are encrypted redirects. So: DuckDuckGo's main site
 * and Google, read in a visible window (--assist for bot checks); block
 * checks on the visible text only; and an engine whose page cannot be read
 * is reported unreadable, never "nothing found".
 *
 * Exported helpers (pure, no I/O - fully unit-testable):
 *   parseSerp(engine, html)          Parse result URLs from SERP HTML
 *   blockReason(text)                'bot check' when the visible text is a block page
 *   hostnameOf(url)                  Extract bare hostname (strips www.)
 *   matchBrokers(serpHosts, brokerHosts) Intersection
 *   buildQuery(person)               Build quoted search query string
 *   hashPerson(fullName, email)      HMAC-SHA256 hex (per-install key) to avoid writing PII
 *
 * Orchestrator (requires live Playwright context):
 *   runSerpScan(context, persons, brokers, opts)
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const { jitterSleep } = require('./timing');
const { hostnameOf, registrableDomain } = require('./domain');
const { waitForHumanCheck } = require('./assist');

// ── HTML mini-parser helpers ─────────────────────────────────────────────────
// Simple regex extraction instead of a real HTML parser (no new npm
// dependencies), over the page as the browser rendered it.

const unescapeHtml = (v) => String(v).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * Decode a DuckDuckGo redirect URL (…?uddg=<encoded_url>) to its destination.
 * Falls back to the raw href if uddg param is absent.
 */
function decodeDdgUrl(href) {
  try {
    const u = new URL(href);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
  } catch (_) {}
  return href;
}

// DuckDuckGo's main site: <a ... data-testid="result-title-a" ... href="...">
function ddgLinks(html) {
  const out = [];
  const re = /<a\b[^>]*\bdata-testid="result-title-a"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = /\bhref="([^"]+)"/i.exec(m[0]);
    if (href) out.push(decodeDdgUrl(unescapeHtml(href[1])));
  }
  return out;
}

// Google: result links are encrypted redirects (google.com/goto?url=...), but
// every result shows its site in a <cite> line ("https://www.spokeo.com › ...").
// Each result has two cites; consecutive repeats are one result.
function googleLinks(html) {
  const out = [];
  const re = /<cite\b[^>]*>([\s\S]*?)<\/cite>/gi;
  let m;
  let last = null;
  while ((m = re.exec(html)) !== null) {
    const text = unescapeHtml(m[1].replace(/<[^>]+>/g, '')).trim();
    const host = /^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})/i.exec(text);
    if (!host) continue;
    const url = `https://${host[1].toLowerCase()}/`;
    if (url === last) continue;
    last = url;
    if (/(^|\.)google\.[a-z.]+\/$/.test(url)) continue;
    out.push(url);
  }
  return out;
}

// ── Exported pure helpers ────────────────────────────────────────────────────

/**
 * Parse result URLs from SERP HTML for the given engine.
 *
 * @param {'ddg'|'google'} engine
 * @param {string} html
 * @returns {Array<{ rank: number, engine: string, url: string }>}
 */
function parseSerp(engine, html) {
  const PARSERS = { ddg: ddgLinks, google: googleLinks };
  if (!PARSERS[engine]) {
    throw new Error(`Unknown engine: "${engine}". Supported: ddg, google`);
  }
  return PARSERS[engine](html || '').map((url, i) => ({ rank: i + 1, engine, url }));
}

// A bot-check page, read from the VISIBLE text: the page source of a normal
// results page contains words like "blocked" and "captcha" in its scripts.
const BLOCK_TEXT = /unusual traffic|not a robot|are you a robot|verify (that )?you('| a)re (a )?human|solve (this|the) (challenge|captcha)|complete the security check/i;
function blockReason(text) {
  return BLOCK_TEXT.test(String(text || '')) ? 'bot check' : null;
}

// An honest empty results page, as opposed to one the parser cannot read.
const NO_RESULTS_TEXT = /did not match any documents|no results (found )?for|no results\.|we couldn't find any results|no more results/i;

/**
 * True when `host` is exactly `base` or a dot-anchored subdomain of `base`.
 * Full hosts are compared (not naive two-label registrable domains) so that a
 * lookalike sharing a multi-part TLD such as attacker.co.uk vs broker.co.uk is
 * rejected rather than collapsed to a shared 'co.uk'.
 *
 * @param {string} host
 * @param {string} base
 * @returns {boolean}
 */
function hostMatchesBase(host, base) {
  if (!host || !base) return false;
  const h = host.toLowerCase().replace(/^www\./, '');
  const b = base.toLowerCase().replace(/^www\./, '');
  return h === b || h.endsWith('.' + b);
}

/**
 * Return the intersection of two hostname arrays (deduplicated).
 * A SERP host matches a broker host when it is exactly that host or a
 * dot-anchored subdomain of it, so subdomains like privacy.spokeo.com match
 * broker entry spokeo.com while lookalikes that only share a suffix
 * (attacker.co.uk vs broker.co.uk) do not.
 *
 * @param {string[]} serpHostnames
 * @param {string[]} brokerHostnames
 * @returns {string[]}
 */
function matchBrokers(serpHostnames, brokerHostnames) {
  const seen = new Set();
  const result = [];
  for (const h of serpHostnames) {
    // Return the canonical broker hostname (the one in brokerHostnames) rather than
    // the SERP subdomain so downstream lookups still work with the broker index.
    const brokerHostname = brokerHostnames.find(bh => hostMatchesBase(h, bh));
    if (brokerHostname && !seen.has(brokerHostname)) {
      seen.add(brokerHostname);
      result.push(brokerHostname);
    }
  }
  return result;
}

/**
 * Build the quoted search query string for a person.
 *
 * @param {{ fullName?: string, firstName?: string, lastName?: string, city: string, state: string }} person
 * @returns {string}
 */
function buildQuery(person) {
  const name = person.fullName || `${person.firstName} ${person.lastName}`;
  return `"${name}" "${person.city}, ${person.state}"`;
}

function readKeyFile(file) {
  try { return fs.readFileSync(file); } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err; // EISDIR, EACCES ...: a clear error, never a silent new key
  }
}

// A short key may belong to a concurrent first run that has created the file
// but not written it yet; give it up to ~200 ms before calling it damaged.
function readSettledKey(file) {
  let key = readKeyFile(file);
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; key && key.length < 32 && i < 20; i++) {
    Atomics.wait(pause, 0, 0, 10);
    key = readKeyFile(file);
  }
  return key;
}

/**
 * Per-install random 32-byte key for hashPerson (audit L14), kept at
 * data/.serp-key (mode 0600, created on first use). Override the location with
 * opts.keyPath or UPEC_WIPE_SERP_KEY_PATH (tests).
 */
function serpKey(keyPath) {
  const file = keyPath || process.env.UPEC_WIPE_SERP_KEY_PATH || path.join(__dirname, '..', 'data', '.serp-key');
  let existing = readSettledKey(file);
  if (existing && existing.length === 32) return existing;
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!existing) {
    try {
      // 'wx': a concurrent first run that already created the key wins; use theirs.
      fs.writeFileSync(file, key, { mode: 0o600, flag: 'wx' });
      return key;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      existing = readSettledKey(file);
      if (existing && existing.length === 32) return existing;
    }
  }
  console.warn(`Warning: ${file} (serp-key) is damaged; replacing it. serp-watch history starts over.`);
  fs.writeFileSync(file, key, { mode: 0o600 });
  return key;
}

/**
 * Return a stable HMAC-SHA256 hex digest of fullName + email, keyed per install.
 * Used as the privacy-safe identifier written to serp-history.json. Unlike the
 * old unsalted sha256, someone holding a candidate name and email cannot confirm
 * it against the file without the key. Rows written by the old scheme no longer
 * match and are simply left behind: history per person resets once (chosen over
 * a migration because personId is only a grouping label).
 *
 * @param {string} fullName
 * @param {string} email
 * @param {{ keyPath?: string }} [opts]
 * @returns {string}  64-char lowercase hex
 */
function hashPerson(fullName, email, opts = {}) {
  return crypto.createHmac('sha256', serpKey(opts.keyPath)).update(`${fullName}|${email}`).digest('hex');
}

// ── Broker hostname index ────────────────────────────────────────────────────

/**
 * Broker sites to look for, keyed on each site's registrable domain so a
 * result on www.spokeo.com matches an opt-out page on privacy.spokeo.com.
 * Search engines' own domains never count (Google's "Results about you"
 * opt-out lives on google.com).
 *
 * @param {object[]} brokers  { name, optOutUrl?|searchUrl? }
 * @returns {Array<{ host: string, name: string }>}
 */
const ENGINE_DOMAINS = new Set(['google.com', 'duckduckgo.com', 'bing.com', 'youtube.com']);
function buildBrokerHostnameIndex(brokers) {
  const index = [];
  const seen = new Set();
  for (const b of brokers) {
    const host = registrableDomain(hostnameOf(b.optOutUrl || b.searchUrl || ''));
    if (!host || ENGINE_DOMAINS.has(host) || seen.has(host)) continue;
    seen.add(host);
    index.push({ host, name: b.name });
  }
  return index;
}

// ── SERP page fetcher ────────────────────────────────────────────────────────

// `ready`: the results container, drawn by script after the page loads.
const ENGINES = [
  {
    id:    'ddg',
    label: 'DuckDuckGo',
    url:   q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=web`,
    ready: '[data-testid="result"]',
  },
  {
    id:    'google',
    label: 'Google',
    url:   q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    ready: '#search',
  },
];

async function visibleText(page) {
  if (typeof page.evaluate !== 'function') return '';
  return String(await page.evaluate(() => (document.body ? document.body.innerText : '')) || '');
}

/**
 * Load one engine's results page. Returns { results } when the page was read
 * (possibly an honest "no results"), or { unreadable: reason }.
 */
async function readEngine(page, eng, query, opts) {
  const resp = await page.goto(eng.url(query), { waitUntil: 'domcontentloaded', timeout: 30000 });
  const status = resp && typeof resp.status === 'function' ? resp.status() : null;
  if (status >= 400) return { unreadable: `HTTP ${status}` };

  let text = await visibleText(page);
  if (blockReason(text)) {
    if (!opts.assist) return { unreadable: 'bot check (run with --assist at the computer)' };
    const wait = opts._wait || waitForHumanCheck;
    const cleared = await wait(page, {
      brokerName: eng.label,
      check: async (p) => (blockReason(await visibleText(p)) ? { solvable: true } : null),
    });
    if (!cleared) return { unreadable: 'bot check not completed in time' };
    text = await visibleText(page);
  }
  if (typeof page.waitForSelector === 'function') {
    await page.waitForSelector(eng.ready, { timeout: 15000 }).catch(() => {});
  }
  const results = parseSerp(eng.id, await page.content());
  if (results.length === 0 && !NO_RESULTS_TEXT.test(text || await visibleText(page))) {
    return { unreadable: 'no results could be read (the page layout may have changed)' };
  }
  return { results };
}

// ── Main orchestrator ────────────────────────────────────────────────────────

const DATA_DIR     = path.join(__dirname, '..', 'data');
const HISTORY_PATH = path.join(DATA_DIR, 'serp-history.json');

/**
 * Run a SERP scan for each person against DuckDuckGo and Google.
 * Compares result domains against the broker sites' domains.
 *
 * @param {import('playwright').BrowserContext} context   Live Playwright context
 * @param {object[]} persons    Array of person objects (firstName, lastName, city, state, email)
 * @param {object[]} brokers    Array of broker definitions from brokers.js
 * @param {{ _skipWrite?: boolean, assist?: boolean, extraBrokers?: object[] }} [opts]
 *   _skipWrite suppresses disk I/O (for tests); extraBrokers adds catalog sites
 * @returns {Promise<SerpScanSummary>}
 */
async function runSerpScan(context, persons, brokers, opts = {}) {
  const skipWrite = opts._skipWrite === true;

  const brokerIndex = buildBrokerHostnameIndex([...brokers, ...(opts.extraBrokers || [])]);

  // Map: brokerName -> { hostname, ranks: { ddg: rank|null, google: rank|null } }
  const appearances = new Map();
  const unreadable = [];
  const read = new Set();

  // Collect all history records for a single batched write at end of scan.
  const pendingHistoryRecords = [];

  for (const person of persons) {
    const name     = person.fullName || `${person.firstName} ${person.lastName}`;
    const query    = buildQuery(person);
    const personId = hashPerson(name, person.email || '');

    console.log(`\n-- SERP scan: ${name} (${person.city}, ${person.state})`);
    console.log(`   Query: ${query}`);

    for (let engineIdx = 0; engineIdx < ENGINES.length; engineIdx++) {
      const eng = ENGINES[engineIdx];

      // Rate-limit between queries: 5-15 seconds (instant in test/turbo envs)
      if (engineIdx > 0 && !opts._noSleep) {
        await jitterSleep(5000, 15000);
      }

      const page = await context.newPage();
      let outcome;
      try {
        outcome = await readEngine(page, eng, query, opts);
      } catch (err) {
        outcome = { unreadable: `navigation error: ${String(err.message || err).split('\n')[0].slice(0, 80)}` };
      } finally {
        await page.close().catch(() => {});
      }

      if (outcome.unreadable) {
        console.log(`   [${eng.label}] could not be read: ${outcome.unreadable}`);
        unreadable.push({ engine: eng.id, label: eng.label, reason: outcome.unreadable });
        continue;
      }
      read.add(eng.id);
      const serpResults = outcome.results;
      console.log(`   [${eng.label}] ${serpResults.length} results read`);

      // Map each result URL to a broker, record the first (lowest) rank
      for (const result of serpResults) {
        const host = hostnameOf(result.url);
        if (!host) continue;
        const brokerEntry = brokerIndex.find(e => hostMatchesBase(host, e.host));
        if (!brokerEntry) continue;
        const brokerName = brokerEntry.name;

        if (!appearances.has(brokerName)) {
          appearances.set(brokerName, { hostname: brokerEntry.host, ranks: { ddg: null, google: null } });
        }
        const ranks = appearances.get(brokerName).ranks;
        // Keep the best (lowest) rank if seen multiple times on same engine
        if (ranks[eng.id] === null || result.rank < ranks[eng.id]) {
          ranks[eng.id] = result.rank;
        }

        // Store only privacy-safe fields: personId (hashed), broker name,
        // engine, rank, and the broker's domain. Never the raw query
        // (plaintext name) or the full URL (may contain name/city).
        if (!skipWrite) {
          pendingHistoryRecords.push({
            personId,
            broker: brokerName,
            engine: eng.id,
            rank: result.rank,
            hostname: brokerEntry.host,
            scannedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  // Batch-write all collected records in a single atomic file operation.
  if (!skipWrite && pendingHistoryRecords.length > 0) {
    appendManyToHistory(pendingHistoryRecords);
  }

  const resultEntries = [...appearances.entries()].map(([broker, entry]) => ({
    broker,
    hostname: entry.hostname,
    ranks: entry.ranks,
  }));

  /** @type {SerpScanSummary} */
  return {
    total_brokers_appearing: resultEntries.length,
    results: resultEntries,
    read: [...read],
    unreadable,
    blocked: [...new Set(unreadable.map(u => u.engine))],
  };
}

// ── History file helpers ─────────────────────────────────────────────────────

/**
 * Maximum number of entries to retain in serp-history.json.
 * Older entries (earliest scannedAt) are dropped when the cap is exceeded.
 */
const HISTORY_MAX = 5000;

/**
 * Atomically append an array of scan entries to data/serp-history.json.
 * Reads the existing file once, appends all new entries, caps at HISTORY_MAX
 * (keeping the most recent entries), then writes once via tmp->rename.
 *
 * @param {object[]} entries
 */
function appendManyToHistory(entries) {
  if (!entries || entries.length === 0) return;
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = HISTORY_PATH + '.tmp';

  let existing = [];
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    existing = JSON.parse(raw);
    if (!Array.isArray(existing)) existing = [];
  } catch (_) {}

  const combined = existing.concat(entries);
  // Cap: keep the most recent HISTORY_MAX entries
  const capped = combined.length > HISTORY_MAX
    ? combined.slice(combined.length - HISTORY_MAX)
    : combined;

  fs.writeFileSync(tmp, JSON.stringify(capped, null, 2));
  fs.renameSync(tmp, HISTORY_PATH);
}

/**
 * Safely read and parse data/serp-history.json.
 * Returns an array of history entries, or [] on any error (missing file,
 * malformed JSON, or a non-array top-level value).
 *
 * @returns {Array<{ personId: string, broker: string, engine: string, rank: number, hostname: string, scannedAt: string }>}
 */
function readHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

module.exports = {
  parseSerp,
  blockReason,
  ENGINES,
  hostnameOf,
  registrableDomain,
  matchBrokers,
  buildQuery,
  hashPerson,
  runSerpScan,
  readHistory,
  HISTORY_PATH,
  HISTORY_MAX,
};

/**
 * @typedef {{
 *   total_brokers_appearing: number,
 *   results: Array<{ broker: string, hostname: string, ranks: { ddg: number|null, google: number|null } }>,
 *   read: string[],                                   engines whose results were read
 *   unreadable: Array<{ engine, label, reason }>,     engines that could not be read
 *   blocked: string[],                                ids of the unreadable engines
 * }} SerpScanSummary
 */
