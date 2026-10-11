# Reviewed Site Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tooling that turns the ~500 generic sites into a reviewed catalog in `data/catalog/` that runs through the same runner and safety checks as the 32 brokers in `brokers.js`.

**Architecture:** Source loaders feed a candidate builder (`data/catalog/candidates.json`). A read-only survey writes one JSON record per site. `lib/catalog.js` validates records and turns reviewed ones into broker objects that `watcher.js` passes to the existing `processBroker`. A drift check flags reviewed sites whose pages changed, and the generic pass skips every catalog domain.

**Tech Stack:** Node 22 CommonJS, `node:test`, Playwright Chromium (existing `lib/playwright-loader`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-site-catalog-design.md`

## Global Constraints

- Node 22, CommonJS, `node:test`. No new runtime dependencies.
- Every network request goes out through the Mullvad gate (`ensureNodeEgress` for Node requests, the existing browser egress check for Playwright).
- Surveys are read-only: they open pages and follow links by URL, and never click buttons, tick boxes, type into fields or submit forms. They use the dummy person (Jane Doe, Austin TX), never `config.json`.
- No personal data in any tracked file. Catalog records hold value tokens such as `{firstName}`, never values.
- The real email is never typed into any form or request. Email fields receive the relay alias (existing value-based swap in `lib/forms.js`).
- Output stays plain text with no emoji. Tracked files contain no em or en dashes (`test/no-em-dashes.test.js`).
- Every change is test-first, and the full suite (`npm test`) passes before each commit.
- Test command for the whole suite: `npm test` (runs `test/*.test.js` with `test/helpers/egress-off.js`). Single file: `node --require ./test/helpers/egress-off.js --test test/<file>.test.js`.

## Review Focus

1. A reviewer types a real value (a name, a city) into a catalog record instead of a token: the loader must reject the record, so no personal data is ever stored or replayed. Pinned in Task 3 (`literal personal value is rejected`).
2. A catalog site on the same registrable domain as one of the 32, but a different subdomain (`members.searchquarry.com` against `searchquarry.com`): the hand-tuned broker wins and the generic pass skips it. Pinned in Task 3 (`subdomain of an explicit host is dropped`) and Task 4 (`generic pass skips subdomains of catalog domains`).
3. An interrupted survey leaves a half-written record: writes are atomic, and the loader skips unparsable JSON with a warning rather than crashing a run. Pinned in Task 5 (`writeRecordAtomic`) and Task 3 (`invalid JSON is skipped with a warning`).
4. The member has no value for a token a reviewed form uses (no ZIP, no date of birth): the field resolves to an empty string so `fillForm` skips it, and `requires: ['dob']` still routes the site to manual. Pinned in Task 3 (`missing person values resolve to empty strings`).
5. A reviewed site now redirects off its domain or loses its form: drift marks it `needs-review`, and at run time it is listed as manual. Pinned in Task 6 (`off-domain opt-out page is drift`).

Known limit, accepted: `registrableDomain` takes the last two labels, so `example.co.uk` style domains collapse to `co.uk`. The candidate list is US registries and US people-search sites; Task 2 drops any candidate whose domain is a bare public suffix (`co.uk`, `com.au`) rather than merge unrelated sites.

---

### Task 1: Registry downloads refuse web pages and keep contact emails; find the live URLs

**Files:**
- Modify: `lib/feeds.js` (header aliases near line 58, `normalizeFeedRow` near line 194, `normalizeRegistryCsv` near line 279)
- Test: `test/feeds-catalog.test.js` (new)
- Modify (only if a live URL is found): `lib/feeds.js` constants `CA_REGISTRY_URL`, `VT_REGISTRY_URL`
- Modify: `STATUS.md` (registry note)

**Interfaces:**
- Consumes: nothing new.
- Produces: `normalizeFeedRow(row, source)` returns `{ name, optOutUrl, method, source }` plus `contact` (string) only when the row has a valid email in an email column. `normalizeRegistryCsv(csv, source, logFn)` throws `Error` whose message contains `is a web page, not CSV` when `csv` starts with `<`.

- [ ] **Step 1: Write the failing test**

```js
// test/feeds-catalog.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFeedRow, normalizeRegistryCsv } = require('../lib/feeds');

test('a registry email column is kept as contact', () => {
  const e = normalizeFeedRow({ 'data broker name': 'Acme', 'website url': 'https://acme.example.com', 'email address': 'privacy@acme.example.com' }, 'ca');
  assert.equal(e.contact, 'privacy@acme.example.com');
});

test('no contact key when the email column is empty or not an email', () => {
  assert.equal('contact' in normalizeFeedRow({ 'data broker name': 'A', 'website url': 'https://a.example.com' }, 'ca'), false);
  assert.equal('contact' in normalizeFeedRow({ 'data broker name': 'A', 'website url': 'https://a.example.com', email: 'n/a' }, 'vt'), false);
});

test('an HTML page instead of CSV is refused with a clear message', () => {
  assert.throws(() => normalizeRegistryCsv('<!DOCTYPE html><html></html>', 'ca'), /California registry download is a web page, not CSV/);
  assert.throws(() => normalizeRegistryCsv('  <html>', 'vt'), /Vermont registry download is a web page, not CSV/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/feeds-catalog.test.js`
Expected: FAIL on all three tests (`contact` undefined; no throw).

- [ ] **Step 3: Write minimal implementation**

In `lib/feeds.js`, after `URL_HEADERS`:

```js
const EMAIL_HEADERS = ['email address', 'email', 'contact email', 'e-mail', 'primary email address', 'privacy email'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
```

In `normalizeFeedRow`, replace the `return { ... }` with:

```js
  const entry = { name, optOutUrl, method: classifyMethod(optOutUrl), source };
  // Kept for phase 2 (emailed requests to business brokers). Only a real
  // address is kept; registries put "n/a" or prose in this column too.
  const contact = pickField(row, EMAIL_HEADERS).toLowerCase();
  if (EMAIL_RE.test(contact)) entry.contact = contact;
  return entry;
```

At the top of `normalizeRegistryCsv`:

```js
  if (/^\s*</.test(String(csv))) {
    const label = source === 'ca' ? 'California' : 'Vermont';
    const envVar = source === 'ca' ? 'CA_REGISTRY_URL' : 'VT_REGISTRY_URL';
    throw new Error(`${label} registry download is a web page, not CSV: the registry may have moved. Set ${envVar} to its current CSV address.`);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --require ./test/helpers/egress-off.js --test test/feeds-catalog.test.js test/feeds-normalize.test.js`
Expected: PASS, including the existing `feeds-normalize` deepEqual test (no `contact` key when there is no email column).

- [ ] **Step 5: Find the live registry downloads**

California: open `https://cppa.ca.gov/data_broker_registry/` (WebFetch) and look for a CSV download link. Vermont: open `https://bizfilings.vermont.gov/online/DatabrokerInquire/` and look for the export link. For each candidate URL, check it through Mullvad:

```bash
node -e '
const { ensureNodeEgress } = require("./lib/egress");
(async () => { await ensureNodeEgress({ network: { required: true } });
  const r = await fetch(process.argv[1]); const t = await r.text();
  console.log(r.status, r.headers.get("content-type"), t.length); console.log(t.split("\n")[0].slice(0, 300)); })();' '<candidate url>'
```

Expected for a usable URL: status 200 and a first line of comma-separated headers (not `<!DOCTYPE`). If found, set the default in `registryUrlFromEnv('CA_REGISTRY_URL', '<url>')` (and the Vermont one) and update the comment above it. If a registry only offers XLSX or a web page, keep the old default and record it.

- [ ] **Step 6: Record the outcome in STATUS.md**

Add under the broker table a line such as: `Registry downloads checked 2026-10-12: California <working URL | only offers XLSX, skipped>; Vermont <...>.` Use the real result from Step 5.

- [ ] **Step 7: Run the suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/feeds.js test/feeds-catalog.test.js STATUS.md
git commit -m "fix(feeds): refuse registry pages that are not CSV, keep contact emails"
```

---

### Task 2: Candidate list builder

**Files:**
- Create: `lib/catalog-sources.js`
- Create: `scripts/catalog-candidates.js`
- Test: `test/catalog-sources.test.js`

**Interfaces:**
- Consumes: `hostnameOf(url)` and `registrableDomain(host)` from `lib/serp-scan.js`; `explicitHostsOf(brokers)` from `lib/feeds.js`; `loadDeadSet()` from `generic-runner.js`.
- Produces:
  - `markupRows(file) -> Array<{ name, url, source: 'markup' }>`
  - `badboolRows(file) -> Array<{ name, url, source: 'badbool' }>`
  - `feedRows(file) -> Array<{ name, url, source: 'ca-registry'|'vt-registry', contact? }>`
  - `buildCandidates({ rows, explicitHosts: Set<string>, deadHosts: Set<string> }) -> Array<{ domain, name, urls: string[], sources: string[], contacts: string[] }>` sorted by domain.
  - File `data/catalog/candidates.json` holding that array.

- [ ] **Step 1: Write the failing test**

```js
// test/catalog-sources.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { markupRows, badboolRows, feedRows, buildCandidates } = require('../lib/catalog-sources');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-cat-'));
const write = (n, v) => { const p = path.join(tmp, n); fs.writeFileSync(p, JSON.stringify(v)); return p; };

test('source loaders read the three formats', () => {
  assert.deepEqual(markupRows(write('m.json', [{ name: 'Acme', urlFinal: 'https://www.acme.com/privacy' }, { name: 'Bad', urlFinal: 'ftp://x' }])),
    [{ name: 'Acme', url: 'https://www.acme.com/privacy', source: 'markup' }]);
  assert.deepEqual(badboolRows(write('b.json', ['https://people.example.com/optout'])),
    [{ name: 'people.example.com', url: 'https://people.example.com/optout', source: 'badbool' }]);
  assert.deepEqual(feedRows(write('f.json', [{ name: 'Reg', optOutUrl: 'https://reg.com', source: 'ca', contact: 'p@reg.com' }])),
    [{ name: 'Reg', url: 'https://reg.com', source: 'ca-registry', contact: 'p@reg.com' }]);
});

test('missing source files give no rows', () => {
  assert.deepEqual(markupRows(path.join(tmp, 'none.json')), []);
});

test('candidates merge by registrable domain and keep every source, url and contact', () => {
  const c = buildCandidates({ rows: [
    { name: 'Acme', url: 'https://www.acme.com/privacy', source: 'markup' },
    { name: 'Acme Inc', url: 'https://optout.acme.com/', source: 'ca-registry', contact: 'p@acme.com' },
  ] });
  assert.equal(c.length, 1);
  assert.equal(c[0].domain, 'acme.com');
  assert.equal(c[0].name, 'Acme');
  assert.deepEqual(c[0].sources, ['markup', 'ca-registry']);
  assert.deepEqual(c[0].urls, ['https://www.acme.com/privacy', 'https://optout.acme.com/']);
  assert.deepEqual(c[0].contacts, ['p@acme.com']);
});

test('explicit brokers, dead hosts and bare public suffixes are dropped', () => {
  const c = buildCandidates({
    rows: [
      { name: 'S', url: 'https://members.searchquarry.com/x', source: 'badbool' },
      { name: 'D', url: 'https://dead.example.org/', source: 'markup' },
      { name: 'U', url: 'https://broker.co.uk/', source: 'markup' },
      { name: 'K', url: 'https://keep.example.net/', source: 'markup' },
    ],
    explicitHosts: new Set(['searchquarry.com']),
    deadHosts: new Set(['dead.example.org']),
  });
  assert.deepEqual(c.map(x => x.domain), ['example.net']);
});

test('http urls are upgraded to https', () => {
  const c = buildCandidates({ rows: [{ name: 'H', url: 'http://h.example.com/a', source: 'markup' }] });
  assert.deepEqual(c[0].urls, ['https://h.example.com/a']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-sources.test.js`
Expected: FAIL with `Cannot find module '../lib/catalog-sources'`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/catalog-sources.js
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
    const host = hostnameOf(url);
    if (!host) continue;
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-sources.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the script**

```js
#!/usr/bin/env node
// scripts/catalog-candidates.js - build data/catalog/candidates.json
//
//   node scripts/catalog-candidates.js
//
// Reads data/markup-parsed.json, data/badbool-extra.json and (when
// `aidr update-brokers` has written it) data/feeds-brokers.json. No network.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { markupRows, badboolRows, feedRows, buildCandidates } = require(path.join(ROOT, 'lib/catalog-sources'));
const { explicitHostsOf } = require(path.join(ROOT, 'lib/feeds'));
const { loadDeadSet } = require(path.join(ROOT, 'generic-runner'));
const brokers = require(path.join(ROOT, 'brokers')).forPerson({ firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', state: 'TX', city: 'Austin', zip: '73301', email: 'jane@example.com', country: 'US' });

const rows = [
  ...markupRows(path.join(ROOT, 'data/markup-parsed.json')),
  ...badboolRows(path.join(ROOT, 'data/badbool-extra.json')),
  ...feedRows(path.join(ROOT, 'data/feeds-brokers.json')),
];
const candidates = buildCandidates({ rows, explicitHosts: explicitHostsOf(brokers), deadHosts: loadDeadSet() });
const out = path.join(ROOT, 'data/catalog/candidates.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(candidates, null, 1) + '\n');
const bySource = {};
for (const r of rows) bySource[r.source] = (bySource[r.source] || 0) + 1;
console.log(`Sources: ${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`Candidates: ${candidates.length} unique sites written to data/catalog/candidates.json`);
```

Note: `loadDeadSet()` takes no arguments and reads `data/dead-urls.json`; if its signature differs when you read `generic-runner.js`, pass what it needs and note it.

- [ ] **Step 6: Run the script**

Run: `node scripts/catalog-candidates.js`
Expected: a `Sources:` line with `markup 494, badbool ...` and `Candidates: <N> unique sites`. N between 300 and 900 depending on whether the registry feed exists.

- [ ] **Step 7: Run the suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/catalog-sources.js scripts/catalog-candidates.js test/catalog-sources.test.js data/catalog/candidates.json
git commit -m "feat(catalog): build the candidate site list from all generic sources"
```

---

### Task 3: Catalog record validation, loader and token resolution

**Files:**
- Create: `lib/catalog.js`
- Test: `test/catalog.test.js`

**Interfaces:**
- Consumes: `hostnameOf(url)`, `registrableDomain(host)` from `lib/serp-scan.js`; `normalizeUsState(v)`, `usStateName(v)` from `lib/us-state.js`; `parseDob(v)` from `lib/dob.js`.
- Produces:
  - `CATALOG_DIR` (string, `<root>/data/catalog`)
  - `TOKENS` (string[])
  - `validateRecord(record, fileName?) -> string|null` (null means valid)
  - `loadCatalog(dir = CATALOG_DIR, warn = console.warn) -> record[]` (skips `candidates.json`)
  - `catalogBrokersForPerson(records, person, { explicitHosts = new Set(), explicitNames = new Set() } = {}) -> broker[]` with brokers shaped like `brokers.forPerson()` output plus `source: 'catalog'`, `domain`, `reviewedAt`.
  - `catalogDomains(records) -> Set<string>`
  - `catalogSummary(records) -> Array<{ name, domain, state, reviewedAt, optOutUrl }>`

- [ ] **Step 1: Write the failing test**

```js
// test/catalog.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateRecord, loadCatalog, catalogBrokersForPerson, catalogDomains, catalogSummary } = require('../lib/catalog');

const base = (over = {}) => ({
  domain: 'example-people.com', name: 'Example People', sources: ['markup'], group: 'people-search',
  survey: { controls: [{ tag: 'select', options: ['subject=The subject', 'agent=An agent'] }] },
  review: { state: 'reviewed', reviewedAt: '2026-10-13', note: 'ok', definition: {
    method: 'direct-form', optOutUrl: 'https://www.example-people.com/opt-out',
    formFields: { '#first': '{firstName}', '#last': '{lastName}', '#email': '{email}', '#agree': 'on', '#who': 'subject' },
    submitSelector: 'form button:has-text("Remove")', captchaLikely: true, requires: [],
  } },
  ...over,
});
const withDef = (d) => { const r = base(); r.review.definition = { ...r.review.definition, ...d }; return r; };
const PERSON = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: 'alias@relay.example', city: 'Austin', state: 'TX', zip: '73301', country: 'US' };

test('a well-formed reviewed record is valid', () => {
  assert.equal(validateRecord(base(), 'example-people.com.json'), null);
});

test('validation rules each reject a bad record', () => {
  const cases = [
    [base({ domain: 'other.com' }), /file name/],
    [base({ group: 'weird' }), /group/],
    [base({ review: { state: 'maybe' } }), /review state/],
    [withDef({ optOutUrl: 'http://www.example-people.com/opt-out' }), /not https/],
    [withDef({ optOutUrl: 'https://evil.com/opt-out' }), /not on example-people.com/],
    [withDef({ formFields: { '#agree': 'on' } }), /none of name or email/],
    [withDef({ formFields: { '#first': '{firstNmae}' } }), /unknown token/],
    [withDef({ method: 'search-form', searchUrl: 'https://example-people.com/s?q={fullName}', listingPattern: '(' }), /listingPattern/],
    [withDef({ formFields: { '#first': '{firstName}', '#m': '{dobMonthName}' } }), /require dob/],
    [base({ review: { state: 'manual', notes: 'x' } }), /https optOutUrl/],
  ];
  for (const [rec, re] of cases) assert.match(String(validateRecord(rec, 'example-people.com.json')), re);
});

test('literal personal value is rejected', () => {
  const err = validateRecord(withDef({ formFields: { '#first': 'Jane', '#email': '{email}' } }), 'example-people.com.json');
  assert.match(err, /literal value for #first is not allowed/);
});

test('a recorded select option value and "on" are allowed literals', () => {
  assert.equal(validateRecord(withDef({ formFields: { '#email': '{email}', '#who': 'agent', '#x': 'on' } }), 'example-people.com.json'), null);
});

test('loadCatalog skips invalid files with a warning and ignores candidates.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-cat-'));
  fs.writeFileSync(path.join(dir, 'example-people.com.json'), JSON.stringify(base()));
  fs.writeFileSync(path.join(dir, 'broken.com.json'), '{ "domain": "broken.com", ');
  fs.writeFileSync(path.join(dir, 'candidates.json'), '[]');
  const warnings = [];
  const recs = loadCatalog(dir, (m) => warnings.push(m));
  assert.deepEqual(recs.map(r => r.domain), ['example-people.com']);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /broken\.com\.json skipped: not valid JSON/);
});

test('invalid JSON is skipped with a warning, a missing directory gives no records and no warning', () => {
  const warnings = [];
  assert.deepEqual(loadCatalog(path.join(os.tmpdir(), 'aidr-no-such-dir'), (m) => warnings.push(m)), []);
  assert.equal(warnings.length, 0);
});

test('a reviewed record becomes a broker with values filled in', () => {
  const [b] = catalogBrokersForPerson([base()], PERSON);
  assert.equal(b.name, 'Example People');
  assert.equal(b.source, 'catalog');
  assert.equal(b.method, 'direct-form');
  assert.deepEqual(b.formFields, { '#first': 'Jane', '#last': 'Doe', '#email': 'alias@relay.example', '#agree': 'on', '#who': 'subject' });
  assert.equal(b.captchaLikely, true);
  assert.equal(b.usOnly, true);
});

test('search urls are url-encoded and listing patterns compiled', () => {
  const [b] = catalogBrokersForPerson([withDef({ method: 'search-form', searchUrl: 'https://example-people.com/s?q={fullName}&st={state}', listingPattern: 'example-people\\.com/p/' })], PERSON);
  assert.equal(b.searchUrl, 'https://example-people.com/s?q=Jane%20Doe&st=TX');
  assert.ok(b.listingPattern instanceof RegExp);
  assert.ok(b.listingPattern.test('https://example-people.com/p/123'));
});

test('state name, birth date tokens and missing person values resolve', () => {
  const rec = withDef({ requires: ['dob'], formFields: { '#email': '{email}', '#st': '{stateName}', '#m': '{dobMonthName}', '#d': '{dobDay}', '#y': '{dobYear}', '#zip': '{zip}' } });
  const [b] = catalogBrokersForPerson([rec], { ...PERSON, dob: '1990-04-07' });
  assert.equal(b.formFields['#st'], 'Texas');
  assert.deepEqual([b.formFields['#m'], b.formFields['#d'], b.formFields['#y']], ['April', '7', '1990']);
  assert.deepEqual(b.requires, ['dob']);
});

test('missing person values resolve to empty strings', () => {
  const rec = withDef({ requires: ['dob'], formFields: { '#email': '{email}', '#zip': '{zip}', '#y': '{dobYear}' } });
  const [b] = catalogBrokersForPerson([rec], { firstName: 'Jane', email: 'a@b.example' });
  assert.equal(b.formFields['#zip'], '');
  assert.equal(b.formFields['#y'], '');
});

test('manual and needs-review records become manual brokers with the link', () => {
  const manual = base({ domain: 'm.com', review: { state: 'manual', optOutUrl: 'https://m.com/privacy', notes: 'Send the request form' } });
  const drift = base({ domain: 'example-people.com' });
  drift.review.state = 'needs-review'; drift.review.note = 'form fields changed';
  const out = catalogBrokersForPerson([manual, drift], PERSON);
  assert.equal(out[0].method, 'manual');
  assert.equal(out[0].notes, 'Send the request form: https://m.com/privacy');
  assert.equal(out[1].method, 'manual');
  assert.match(out[1].notes, /needs review \(form fields changed\) - do it by hand: https:\/\/www\.example-people\.com\/opt-out/);
});

test('unreviewed and excluded records do nothing at run time', () => {
  const a = base({ domain: 'a.com', review: { state: 'unreviewed' } });
  const b = base({ domain: 'b.com', review: { state: 'excluded' } });
  assert.deepEqual(catalogBrokersForPerson([a, b], PERSON), []);
});

test('subdomain of an explicit host is dropped, and so is a name clash', () => {
  const recs = [base({ domain: 'searchquarry.com' }), base({ domain: 'x.com', name: 'Spokeo' })];
  const out = catalogBrokersForPerson(recs, PERSON, { explicitHosts: new Set(['members.searchquarry.com']), explicitNames: new Set(['spokeo']) });
  assert.deepEqual(out, []);
});

test('catalogDomains and catalogSummary list every record', () => {
  const recs = [base(), base({ domain: 'm.com', review: { state: 'manual', optOutUrl: 'https://m.com/p' } })];
  assert.deepEqual([...catalogDomains(recs)], ['example-people.com', 'm.com']);
  assert.deepEqual(catalogSummary(recs).map(s => [s.name, s.state, s.optOutUrl]), [
    ['Example People', 'reviewed', 'https://www.example-people.com/opt-out'],
    ['Example People', 'manual', 'https://m.com/p'],
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog.test.js`
Expected: FAIL with `Cannot find module '../lib/catalog'`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/catalog.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog.test.js`
Expected: PASS (14 tests).

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/catalog.js test/catalog.test.js
git commit -m "feat(catalog): validate catalog records and build brokers from reviewed ones"
```

---

### Task 4: Run catalog sites, list them, and keep the generic pass off them

**Files:**
- Modify: `watcher.js` (`_mainBody` broker loop near line 957, explicit host set near line 1012, `--list` block near line 204)
- Modify: `generic-runner.js` (`loadGenericBrokers` near line 428: three `seen.has(host)` checks)
- Modify: `dashboard/server.js` (`/api/brokers` near line 474)
- Test: `test/catalog-runner.test.js` (new), `test/generic-catalog-exclusion.test.js` (new)
- Modify: `README.md`, `docs/UPEC-MANUAL.md` (one paragraph each)

**Interfaces:**
- Consumes: `loadCatalog`, `catalogBrokersForPerson`, `catalogDomains`, `catalogSummary` (Task 3); `explicitHostsOf` (`lib/feeds.js`); `processBroker`, `configure` (`lib/broker-runner.js`); `registrableDomain` (`lib/serp-scan.js`).
- Produces: catalog brokers in the per-person run list after the 32; `--list` section `Catalog sites`; `/api/brokers` entries with `source: 'catalog'`; generic pass excludes catalog domains and their subdomains.

- [ ] **Step 1: Write the failing tests**

```js
// test/catalog-runner.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const originalLoad = Module._load.bind(Module);
const { catalogBrokersForPerson } = require('../lib/catalog');

const watcherSrc = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');

test('the run appends catalog brokers after the 32, for each person', () => {
  assert.match(watcherSrc, /const personBrokers = \[\s*\.\.\.brokers\.forPerson\(person\),\s*\.\.\.catalogBrokersForPerson\(catalogRecords, person, \{/);
});

test('--list prints the catalog sites', () => {
  assert.match(watcherSrc, /Catalog sites/);
  assert.match(watcherSrc, /catalogSummary\(/);
});

test('the generic pass is told about every catalog domain', () => {
  assert.match(watcherSrc, /for \(const d of catalogDomains\(catalogRecords\)\) explicitHosts\.add\(d\);/);
});

// A reviewed catalog broker goes through processBroker with the same guards.
const logged = [];
let fillReport = { filled: [], missed: ['#first'] };
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, d) => logged.push({ name, status, detail: d }) };
  if (request === './forms') return { fillForm: async () => fillReport, findListingUrl: async () => null };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlockedDetail: async () => null };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;

const ctx = { newPage: async () => ({ goto: async () => ({ status: () => 200 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const REC = { domain: 'example-people.com', name: 'Example People', group: 'people-search', review: { state: 'reviewed', reviewedAt: '2026-10-13', definition: {
  method: 'direct-form', optOutUrl: 'https://example-people.com/opt-out', formFields: { '#first': '{firstName}', '#email': '{email}' } } } };

test('a catalog form that fills nothing is listed as manual, never submitted', async () => {
  logged.length = 0; fillReport = { filled: [], missed: ['#first', '#email'] };
  const [b] = catalogBrokersForPerson([REC], { firstName: 'Jane', email: 'alias@relay.example', country: 'US' });
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, b);
  assert.equal(logged.at(-1).status, 'manual');
  assert.match(logged.at(-1).detail, /form not recognised/);
});

test('a catalog form that fills is previewed like any broker', async () => {
  logged.length = 0; fillReport = { filled: [{ selector: '#first', value: 'Jane', kind: 'text' }], missed: [] };
  const [b] = catalogBrokersForPerson([REC], { firstName: 'Jane', email: 'alias@relay.example', country: 'US' });
  configure({ dryRun: true, preview: true, person: { country: 'US' } });
  await processBroker(ctx, b);
  assert.equal(logged.at(-1).status, 'preview');
});
```

```js
// test/generic-catalog-exclusion.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadGenericBrokers } = require('../generic-runner');

test('generic pass skips subdomains of catalog domains', () => {
  // BADBOOL lists https://members.searchquarry.com/removeMyData
  const all = loadGenericBrokers(new Set());
  assert.ok(all.some(b => b.url.includes('members.searchquarry.com')), 'fixture site is in BADBOOL');
  const without = loadGenericBrokers(new Set(['searchquarry.com']));
  assert.ok(!without.some(b => b.url.includes('searchquarry.com')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-runner.test.js test/generic-catalog-exclusion.test.js`
Expected: FAIL on the three watcher source tests and the generic exclusion test; the two processBroker tests already PASS (they pin that catalog brokers need no special runner code).

- [ ] **Step 3: Implement**

`generic-runner.js`: add near the other requires

```js
const { registrableDomain } = require('./lib/serp-scan');
```

and in `loadGenericBrokers`, replace each of the three `if (seen.has(host)) continue;` lines with

```js
        if (seen.has(host) || seen.has(registrableDomain(host))) continue;
```

`watcher.js` in `_mainBody`, after `const brokers = require('./brokers');`:

```js
  const { loadCatalog, catalogBrokersForPerson, catalogDomains } = require('./lib/catalog');
  const { explicitHostsOf } = require('./lib/feeds');
  // Reviewed sites from data/catalog/ run after the 32, through the same
  // processBroker path. A bad record is skipped with a warning by the loader.
  const catalogRecords = loadCatalog();
  const explicitCatalogOpts = {
    explicitHosts: explicitHostsOf(brokers),
    explicitNames: new Set(brokers.map(b => b.name.toLowerCase())),
  };
```

Replace `const personBrokers = brokers.forPerson(person);` with

```js
    const personBrokers = [
      ...brokers.forPerson(person),
      ...catalogBrokersForPerson(catalogRecords, person, explicitCatalogOpts),
    ];
```

After the `explicitHosts` set is built (before the generic pass):

```js
  for (const d of catalogDomains(catalogRecords)) explicitHosts.add(d);
```

In the `--list` block, after the existing loop and before `console.log('');`:

```js
  const { loadCatalog, catalogSummary } = require('./lib/catalog');
  const catalog = catalogSummary(loadCatalog());
  if (catalog.length) {
    console.log(`\nCatalog sites (${catalog.length})`);
    console.log('-'.repeat(80));
    for (const c of catalog) {
      const entry = state.optOuts && state.optOuts[c.name];
      const last = entry && entry.lastSuccess ? entry.lastSuccess.slice(0, 10) : '-';
      console.log(pad(c.name, 40) + pad(c.state + (c.reviewedAt ? ` ${c.reviewedAt}` : ''), 28) + last);
    }
  }
```

`dashboard/server.js` `/api/brokers`: after the `list` is built from `loadBrokers()`, append

```js
  try {
    const { loadCatalog, catalogSummary } = require('../lib/catalog');
    for (const c of catalogSummary(loadCatalog(undefined, () => {}))) {
      if (c.state === 'unreviewed' || c.state === 'excluded') continue;
      list.push({ name: c.name, method: `catalog (${c.state})`, priority: 5, usOnly: true, captchaLikely: false,
        confidence: c.reviewedAt ? `reviewed ${c.reviewedAt}` : null, optOutUrl: c.optOutUrl, note: null, source: 'catalog' });
    }
  } catch (_) { /* catalog is optional */ }
```

(If `list` is declared with `const` and returned inline, keep the shape: build it, append, then send.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-runner.test.js test/generic-catalog-exclusion.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Docs**

`README.md`, after the "Generic - 500+ additional brokers" section, add:

```markdown
### Reviewed site catalog

Sites from the generic lists that have been checked by hand live in `data/catalog/`, one file per site. Reviewed sites run after the main brokers, with the same checks and the same status words; sites that need you get a link under Action Required. The generic pass never visits a site the catalog knows. See `docs/CATALOG-REVIEW.md` for how sites are surveyed and reviewed.
```

`docs/UPEC-MANUAL.md`, in the "Useful options" paragraph, add after `--generic (...)`: ``, `aidr list` (also lists the reviewed catalog sites and when each was checked)``.

- [ ] **Step 6: Run the suite and the dashboard tests, then commit**

Run: `npm test && (cd dashboard && npm test)`
Expected: all pass.

```bash
git add watcher.js generic-runner.js dashboard/server.js test/catalog-runner.test.js test/generic-catalog-exclusion.test.js README.md docs/UPEC-MANUAL.md
git commit -m "feat(catalog): run reviewed catalog sites, list them, keep --generic off them"
```

---

### Task 5: Survey building blocks

**Files:**
- Create: `lib/page-dump.js` (moves `dumpFrame` out of `scripts/inspect-broker-forms.js`)
- Modify: `scripts/inspect-broker-forms.js` (import `dumpFrame`)
- Modify: `test/inspect-broker-forms.test.js` (the dump assertions read `lib/page-dump.js`)
- Create: `lib/catalog-survey-core.js`
- Test: `test/catalog-survey-core.test.js`

**Interfaces:**
- Consumes: `hostnameOf`, `registrableDomain` (`lib/serp-scan.js`).
- Produces:
  - `dumpFrame` (function evaluated in the page; returns `{ controls, buttons, links, captcha, text }`, unchanged behaviour)
  - `hasIdentityField(controls) -> boolean`
  - `classifyGroup({ status, error, blocked, title, text, controls }) -> 'dead'|'blocked'|'people-search'|'business'|'unknown'`
  - `optOutLinks(links, baseUrl, domain) -> string[]` (at most 3, same site, https)
  - `emailContacts(links, domain) -> string[]`
  - `fingerprint(controls) -> string` (sha256 hex)
  - `mergeSurvey(existing|null, candidate, survey) -> record`
  - `writeRecordAtomic(dir, record) -> string` (path written)

- [ ] **Step 1: Move `dumpFrame`**

Create `lib/page-dump.js`:

```js
'use strict';
/**
 * lib/page-dump.js
 *
 * dumpFrame runs inside a page (page.evaluate) and records the visible form
 * controls, buttons, opt-out-ish links, CAPTCHA presence and some page text.
 * Read-only: it never clicks, types or submits. Shared by the broker form
 * survey and the catalog survey.
 */
```

then move the whole `function dumpFrame() { ... }` body from `scripts/inspect-broker-forms.js` into it unchanged, followed by `module.exports = { dumpFrame };`. In `scripts/inspect-broker-forms.js` replace the function with:

```js
const { dumpFrame } = require(path.join(ROOT, 'lib/page-dump'));
```

In `test/inspect-broker-forms.test.js`, add `const dumpSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'page-dump.js'), 'utf8');` and change the assertions on `const links = [...document.querySelectorAll('a')]`, `form: `, `heading: ` and `options: ` from `src` to `dumpSrc`. Keep the read-only assertion on both: `for (const s of [src, dumpSrc]) assert.doesNotMatch(s, /\.click\(|\.submit\(|requestSubmit|press\('Enter'\)/);`.

Run: `node --require ./test/helpers/egress-off.js --test test/inspect-broker-forms.test.js`
Expected: PASS.

- [ ] **Step 2: Write the failing test**

```js
// test/catalog-survey-core.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../lib/catalog-survey-core');

const C = (o) => ({ tag: 'input', type: 'text', name: '', id: '', placeholder: '', aria: '', label: '', ...o });

test('identity fields are name or email inputs, not search boxes', () => {
  assert.equal(core.hasIdentityField([C({ id: 'first-name' })]), true);
  assert.equal(core.hasIdentityField([C({ type: 'email' })]), true);
  assert.equal(core.hasIdentityField([C({ placeholder: 'Search by name' })]), false);
  assert.equal(core.hasIdentityField([]), false);
});

test('groups', () => {
  assert.equal(core.classifyGroup({ error: 'net::ERR_NAME_NOT_RESOLVED at https://x' }), 'dead');
  assert.equal(core.classifyGroup({ status: 404 }), 'dead');
  assert.equal(core.classifyGroup({ status: 403, blocked: { reason: 'x', solvable: true } }), 'blocked');
  assert.equal(core.classifyGroup({ error: 'Timeout 25000ms exceeded' }), 'unknown');
  assert.equal(core.classifyGroup({ status: 200, title: 'Free People Search', text: '', controls: [] }), 'people-search');
  assert.equal(core.classifyGroup({ status: 200, title: 'Opt out', text: '', controls: [C({ placeholder: 'Search people by name' })] }), 'people-search');
  assert.equal(core.classifyGroup({ status: 200, title: 'Privacy Policy | Acme Ads', text: 'cookies', controls: [] }), 'business');
});

test('opt-out links: same site, https, opt-out words, at most 3, no repeats', () => {
  const links = [
    { text: 'Do Not Sell My Info', href: '/dns' },
    { text: 'Opt out', href: 'https://other.com/optout' },
    { text: 'Privacy Policy', href: '/privacy' },
    { text: 'Remove my record', href: 'https://help.acme.com/remove' },
    { text: 'Delete', href: '/delete#top' },
    { text: 'Opt-out', href: '/optout' },
    { text: 'again', href: '/dns' },
  ];
  assert.deepEqual(core.optOutLinks(links, 'https://www.acme.com/privacy', 'acme.com'), [
    'https://www.acme.com/dns', 'https://help.acme.com/remove', 'https://www.acme.com/delete',
  ]);
});

test('email contacts are the site\'s own mailto addresses', () => {
  const links = [{ text: 'privacy@acme.com', href: 'mailto:privacy@acme.com' }, { text: 'x', href: 'mailto:someone@gmail.com' }, { text: 'y', href: 'mailto:PRIVACY@acme.com?subject=x' }];
  assert.deepEqual(core.emailContacts(links, 'acme.com'), ['privacy@acme.com']);
});

test('fingerprint ignores order and changes when a field changes', () => {
  const a = [C({ id: 'first' }), C({ id: 'email', type: 'email' })];
  assert.equal(core.fingerprint(a), core.fingerprint([...a].reverse()));
  assert.notEqual(core.fingerprint(a), core.fingerprint([C({ id: 'fname' }), a[1]]));
});

test('mergeSurvey keeps the review, unions sources and sets the group', () => {
  const existing = { domain: 'acme.com', name: 'Acme', sources: ['markup'], group: 'unknown', review: { state: 'reviewed', note: 'x' } };
  const cand = { domain: 'acme.com', name: 'Acme Inc', sources: ['ca-registry'], urls: ['https://acme.com'], contacts: ['p@acme.com'] };
  const rec = core.mergeSurvey(existing, cand, { group: 'people-search', checkedAt: 't', contacts: ['privacy@acme.com'] });
  assert.equal(rec.name, 'Acme');
  assert.deepEqual(rec.sources, ['markup', 'ca-registry']);
  assert.equal(rec.group, 'people-search');
  assert.deepEqual(rec.review, { state: 'reviewed', note: 'x' });
  assert.deepEqual(rec.survey.contacts, ['p@acme.com', 'privacy@acme.com']);
  assert.equal('group' in rec.survey, false);
});

test('mergeSurvey for a new site starts unreviewed, and a group override wins', () => {
  const cand = { domain: 'n.com', name: 'N', sources: ['markup'], urls: ['https://n.com'], contacts: [] };
  assert.deepEqual(core.mergeSurvey(null, cand, { group: 'business' }).review, { state: 'unreviewed' });
  const over = core.mergeSurvey({ domain: 'n.com', name: 'N', sources: [], group: 'business', review: { state: 'unreviewed', groupOverride: 'people-search' } }, cand, { group: 'business' });
  assert.equal(over.group, 'people-search');
});

test('writeRecordAtomic writes the whole record and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-cat-'));
  const p = core.writeRecordAtomic(dir, { domain: 'acme.com', name: 'Acme' });
  assert.equal(p, path.join(dir, 'acme.com.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')), { domain: 'acme.com', name: 'Acme' });
  assert.deepEqual(fs.readdirSync(dir), ['acme.com.json']);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-survey-core.test.js`
Expected: FAIL with `Cannot find module '../lib/catalog-survey-core'`.

- [ ] **Step 4: Write minimal implementation**

```js
// lib/catalog-survey-core.js
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
const { hostnameOf } = require('./serp-scan');

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

function mergeSurvey(existing, candidate, survey) {
  const prev = existing || {};
  const review = prev.review || { state: 'unreviewed' };
  const { group, ...surveyRest } = survey || {};
  const contacts = [...new Set([...(candidate.contacts || []), ...((survey && survey.contacts) || [])])];
  return {
    domain: candidate.domain,
    name: prev.name || candidate.name,
    sources: [...new Set([...(prev.sources || []), ...(candidate.sources || [])])],
    group: review.groupOverride || group || prev.group || 'unknown',
    survey: { ...surveyRest, contacts },
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-survey-core.test.js test/inspect-broker-forms.test.js`
Expected: PASS.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/page-dump.js lib/catalog-survey-core.js scripts/inspect-broker-forms.js test/catalog-survey-core.test.js test/inspect-broker-forms.test.js
git commit -m "feat(catalog): survey building blocks (grouping, opt-out links, fingerprint, merge)"
```

---

### Task 6: Drift detection

**Files:**
- Create: `lib/catalog-drift.js`
- Test: `test/catalog-drift.test.js`

**Interfaces:**
- Consumes: `hostnameOf` (`lib/serp-scan.js`); record shape from Task 3; survey shape from Task 5 (`{ status, block, optOutUrl, controls, fingerprint, error }`).
- Produces:
  - `detectDrift(record, survey) -> string|null` (reason, or null when unchanged or not reviewed)
  - `applyDrift(record, reason, today) -> record` (state `needs-review`, `note` set, definition kept)

- [ ] **Step 1: Write the failing test**

```js
// test/catalog-drift.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectDrift, applyDrift } = require('../lib/catalog-drift');

const controls = [{ tag: 'input', type: 'text', id: 'first', name: 'first', placeholder: '' }, { tag: 'input', type: 'email', id: 'email', name: 'email', placeholder: '' }];
const rec = () => ({ domain: 'acme.com', name: 'Acme', group: 'people-search',
  survey: { fingerprint: 'F1', optOutUrl: 'https://acme.com/optout' },
  review: { state: 'reviewed', reviewedAt: '2026-10-13', definition: { method: 'direct-form', optOutUrl: 'https://acme.com/optout', formFields: { '#first': '{firstName}', '#email': '{email}' } } } });
const fresh = (o = {}) => ({ status: 200, block: null, optOutUrl: 'https://acme.com/optout', controls, fingerprint: 'F1', ...o });

test('an unchanged page is not drift', () => { assert.equal(detectDrift(rec(), fresh()), null); });
test('only reviewed records drift', () => { const r = rec(); r.review.state = 'manual'; assert.equal(detectDrift(r, fresh({ status: 404 })), null); });
test('a dead page is drift', () => { assert.match(detectDrift(rec(), fresh({ status: 404 })), /page gone \(HTTP 404\)/); });
test('an error is drift', () => { assert.match(detectDrift(rec(), fresh({ error: 'net::ERR_NAME_NOT_RESOLVED' })), /did not load/); });
test('a new block page is drift', () => { assert.match(detectDrift(rec(), fresh({ block: 'hard' })), /now blocked/); });
test('off-domain opt-out page is drift', () => { assert.match(detectDrift(rec(), fresh({ optOutUrl: 'https://other.com/optout' })), /moved to other\.com/); });
test('a moved path is drift', () => { assert.match(detectDrift(rec(), fresh({ optOutUrl: 'https://acme.com/privacy' })), /moved to \/privacy/); });
test('a missing selector is drift', () => { assert.match(detectDrift(rec(), fresh({ controls: [controls[1]], fingerprint: 'F2' })), /#first no longer on the page/); });
test('a changed form fingerprint alone is drift', () => { assert.match(detectDrift(rec(), fresh({ fingerprint: 'F2' })), /form fields changed/); });

test('applyDrift marks needs-review and keeps the definition', () => {
  const r = applyDrift(rec(), 'form fields changed', '2026-11-01');
  assert.equal(r.review.state, 'needs-review');
  assert.equal(r.review.note, 'form fields changed (found 2026-11-01)');
  assert.ok(r.review.definition);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-drift.test.js`
Expected: FAIL with `Cannot find module '../lib/catalog-drift'`.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/catalog-drift.js
'use strict';
/**
 * lib/catalog-drift.js
 *
 * A reviewed catalog site whose page changed must not be filled blind (the
 * TruePeopleSearch and DataAxle lessons of 2026-10-11). detectDrift compares a
 * fresh survey with the record; applyDrift parks the record as needs-review,
 * which runs as manual until it is reviewed again.
 */
const { hostnameOf } = require('./serp-scan');

// Selectors the survey can check: plain #id and [name="..."] forms.
function selectorPresent(sel, controls) {
  const id = /^#([\w-]+)$/.exec(sel);
  if (id) return controls.some(c => c.id === id[1]);
  const name = /\[name="([^"]+)"\]/.exec(sel);
  if (name && !/[,:]/.test(sel)) return controls.some(c => c.name === name[1]);
  return true; // scoped or text selectors are covered by the fingerprint
}

function detectDrift(record, survey) {
  const rv = record && record.review;
  if (!rv || rv.state !== 'reviewed' || !survey) return null;
  if (survey.error) return `opt-out page did not load (${String(survey.error).slice(0, 60)})`;
  if (survey.status === 404 || survey.status === 410) return `opt-out page gone (HTTP ${survey.status})`;
  if (survey.block) return `opt-out page is now blocked (${survey.block})`;
  const want = new URL(rv.definition.optOutUrl);
  if (survey.optOutUrl) {
    const got = new URL(survey.optOutUrl);
    const gotHost = hostnameOf(survey.optOutUrl);
    if (!(gotHost === record.domain || gotHost.endsWith(`.${record.domain}`))) return `opt-out page moved to ${gotHost}`;
    if (got.pathname.replace(/\/$/, '') !== want.pathname.replace(/\/$/, '')) return `opt-out page moved to ${got.pathname}`;
  }
  for (const sel of Object.keys(rv.definition.formFields || {})) {
    if (!selectorPresent(sel, survey.controls || [])) return `${sel} no longer on the page`;
  }
  if (record.survey && record.survey.fingerprint && survey.fingerprint && record.survey.fingerprint !== survey.fingerprint) return 'form fields changed';
  return null;
}

function applyDrift(record, reason, today) {
  return { ...record, review: { ...record.review, state: 'needs-review', note: `${reason} (found ${today})` } };
}

module.exports = { detectDrift, applyDrift };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-drift.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add lib/catalog-drift.js test/catalog-drift.test.js
git commit -m "feat(catalog): flag reviewed sites whose opt-out page changed"
```

---

### Task 7: The catalog survey script and `aidr catalog-check`

**Files:**
- Create: `scripts/catalog-survey.js`
- Modify: `lib/cli-map.js` (add `catalog-check`)
- Test: `test/catalog-survey-script.test.js`, and add one case to the existing cli-map test file (find it with `grep -l "resolveCommand" test/*.js`)

**Interfaces:**
- Consumes: `dumpFrame` (Task 5), all of `lib/catalog-survey-core.js` (Task 5), `detectDrift`, `applyDrift` (Task 6), `CATALOG_DIR` (Task 3), `checkPageBlockedDetail` (`lib/block-page.js`), `waitForHumanCheck` (`lib/assist.js`), `ensureNodeEgress` (`lib/egress.js`), `loadChromium` (`lib/playwright-loader.js`), `buildLaunchOptions` (`lib/browser.js`), `buildStealthScript` (`lib/stealth.js`).
- Produces: records in `data/catalog/<domain>.json`; CLI `node scripts/catalog-survey.js [--group <g>] [--only <domain>[,<domain>]] [--resume] [--reviewed]`, env `ASSIST=1`, `WAIT=<ms>`; `aidr catalog-check` = `scripts/catalog-survey.js --reviewed`.

- [ ] **Step 1: Write the failing test**

```js
// test/catalog-survey-script.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'catalog-survey.js'), 'utf8');
const { resolveCommand } = require('../lib/cli-map');

test('the catalog survey is read-only', () => {
  assert.doesNotMatch(src, /\.click\(|\.check\(|\.fill\(|\.type\(|\.submit\(|requestSubmit|press\(/);
});
test('it never reads the member config', () => {
  assert.doesNotMatch(src, /loadConfig|config\.json/);
});
test('it checks Mullvad before visiting anything', () => {
  assert.ok(src.indexOf('ensureNodeEgress') < src.indexOf('chromium.launch'));
});
test('it writes records atomically, merges and checks drift', () => {
  for (const s of ['writeRecordAtomic(', 'mergeSurvey(', 'detectDrift(', 'applyDrift(']) assert.ok(src.includes(s), s);
});
test('ASSIST=1 waits for the member at solvable checks', () => {
  assert.match(src, /process\.env\.ASSIST === '1'/);
  assert.match(src, /waitForHumanCheck\(page/);
});
test('--resume skips sites surveyed in the last 7 days', () => {
  assert.match(src, /RESUME_DAYS = 7/);
});
test('aidr catalog-check runs the survey over reviewed sites', () => {
  const r = resolveCommand(['catalog-check']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.args, ['scripts/catalog-survey.js', '--reviewed']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-survey-script.test.js`
Expected: FAIL with `ENOENT` reading `scripts/catalog-survey.js`.

- [ ] **Step 3: Write the script**

```js
#!/usr/bin/env node
/**
 * scripts/catalog-survey.js - read-only survey of catalog candidates.
 *
 *   node scripts/catalog-survey.js                     every candidate
 *   node scripts/catalog-survey.js --group blocked     only sites last grouped "blocked"
 *   node scripts/catalog-survey.js --only a.com,b.com
 *   node scripts/catalog-survey.js --resume            skip sites surveyed in the last 7 days
 *   node scripts/catalog-survey.js --reviewed          reviewed sites only, report drift (aidr catalog-check)
 *   ASSIST=1 node scripts/catalog-survey.js --group blocked   visible window; complete each bot check
 *
 * Opens pages and follows opt-out links by URL. Never clicks, types or
 * submits. Uses no personal data. Writes data/catalog/<domain>.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadChromium } = require(path.join(ROOT, 'lib/playwright-loader'));
const { buildLaunchOptions } = require(path.join(ROOT, 'lib/browser'));
const { buildStealthScript } = require(path.join(ROOT, 'lib/stealth'));
const { ensureNodeEgress } = require(path.join(ROOT, 'lib/egress'));
const { checkPageBlockedDetail } = require(path.join(ROOT, 'lib/block-page'));
const { waitForHumanCheck } = require(path.join(ROOT, 'lib/assist'));
const { dumpFrame } = require(path.join(ROOT, 'lib/page-dump'));
const { CATALOG_DIR } = require(path.join(ROOT, 'lib/catalog'));
const core = require(path.join(ROOT, 'lib/catalog-survey-core'));
const { detectDrift, applyDrift } = require(path.join(ROOT, 'lib/catalog-drift'));

const ASSIST = process.env.ASSIST === '1';
const WAIT = Number(process.env.WAIT || 3000);
const RESUME_DAYS = 7;
const argv = process.argv.slice(2);
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const GROUP = argOf('--group');
const ONLY = (argOf('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
const RESUME = argv.includes('--resume');
const REVIEWED = argv.includes('--reviewed');

function readRecord(domain) {
  try { return JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, `${domain}.json`), 'utf8')); } catch (_) { return null; }
}

function wanted(cand, rec) {
  if (ONLY.length && !ONLY.includes(cand.domain)) return false;
  if (REVIEWED) return !!(rec && rec.review && rec.review.state === 'reviewed');
  if (GROUP && (!rec || rec.group !== GROUP)) return false;
  if (RESUME && rec && rec.survey && rec.survey.checkedAt && (Date.now() - Date.parse(rec.survey.checkedAt)) < RESUME_DAYS * 864e5) return false;
  return true;
}

async function surveyOne(ctx, cand, rec) {
  const page = await ctx.newPage();
  const out = { checkedAt: new Date().toISOString() };
  try {
    // A reviewed site is checked at its reviewed opt-out page.
    const start = (rec && rec.review && rec.review.definition && rec.review.definition.optOutUrl) || cand.urls[0];
    const resp = await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 25000 });
    out.status = resp ? resp.status() : null;
    let blocked = await checkPageBlockedDetail(page, resp);
    if (blocked && blocked.solvable && ASSIST && await waitForHumanCheck(page, { brokerName: cand.domain })) blocked = null;
    await page.waitForTimeout(WAIT);
    let dump = await page.mainFrame().evaluate(dumpFrame);
    let title = await page.title();
    if (!blocked && !REVIEWED && !core.hasIdentityField(dump.controls)) {
      for (const next of core.optOutLinks(dump.links, page.url(), cand.domain)) {
        const r2 = await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => null);
        if (!r2) continue;
        await page.waitForTimeout(WAIT);
        const d2 = await page.mainFrame().evaluate(dumpFrame).catch(() => null);
        if (d2 && core.hasIdentityField(d2.controls)) { dump = d2; out.status = r2.status(); title = await page.title(); break; }
      }
    }
    out.optOutUrl = page.url();
    out.title = title;
    out.block = blocked ? (blocked.solvable ? 'challenge' : 'hard') : null;
    out.controls = dump.controls;
    out.buttons = dump.buttons;
    out.captcha = dump.captcha;
    out.contacts = core.emailContacts(dump.links, cand.domain);
    out.text = String(dump.text || '').slice(0, 600);
    out.fingerprint = core.fingerprint(dump.controls);
    out.group = core.classifyGroup({ status: out.status, blocked, title, text: dump.text, controls: dump.controls });
  } catch (e) {
    out.error = String(e.message).split('\n')[0];
    out.group = core.classifyGroup({ error: out.error });
  }
  await page.close().catch(() => {});
  return out;
}

(async () => {
  // Same rule as a run: nothing leaves this machine unless it goes out via Mullvad.
  await ensureNodeEgress({ network: { required: true } });
  const candidates = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'candidates.json'), 'utf8'));
  const todo = candidates.map(c => [c, readRecord(c.domain)]).filter(([c, r]) => wanted(c, r));
  console.log(`Surveying ${todo.length} site(s)${ASSIST ? ' with ASSIST (complete each bot check in the window)' : ''}.`);
  const chromium = loadChromium();
  const browser = await chromium.launch(buildLaunchOptions({ headless: !ASSIST }));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(buildStealthScript()).catch(() => {});
  const today = new Date().toISOString().slice(0, 10);
  const drifted = [];
  let n = 0;
  for (const [cand, rec] of todo) {
    const survey = await surveyOne(ctx, cand, rec);
    const reason = detectDrift(rec, survey);
    let record = core.mergeSurvey(rec, cand, survey);
    if (reason) { record = applyDrift(record, reason, today); drifted.push(`${cand.domain}: ${reason}`); }
    core.writeRecordAtomic(CATALOG_DIR, record);
    n += 1;
    console.log(`${String(n).padStart(4)}/${todo.length} ${cand.domain.padEnd(34)} ${record.group.padEnd(14)} ${survey.status || '-'} controls=${(survey.controls || []).length}${reason ? ' DRIFT: ' + reason : ''}${survey.error ? ' ' + survey.error.slice(0, 60) : ''}`);
  }
  await browser.close();
  if (REVIEWED) console.log(drifted.length ? `\n${drifted.length} reviewed site(s) changed and now need review:\n  ${drifted.join('\n  ')}` : '\nNo reviewed site changed.');
})().catch(e => { console.error(e.message); process.exit(1); });
```

In `lib/cli-map.js` add to `COMMANDS` after `'update-brokers'`:

```js
  'catalog-check':  { file: 'scripts/catalog-survey.js', flags: ['--reviewed'],  cwd: 'root',      desc: 'Re-check reviewed catalog sites and flag any whose opt-out page changed' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-survey-script.test.js`
Expected: PASS (7 tests). If `aidr --help` output is pinned by an existing test, update that test's expected command list to include `catalog-check`.

- [ ] **Step 5: Live smoke test (read-only, Mullvad on)**

Run: `node scripts/catalog-survey.js --only <two domains from data/catalog/candidates.json>`
Expected: two progress lines and two new files in `data/catalog/`. Open one and check: no personal data, `review.state` is `unreviewed`, `survey.controls` filled when the page has a form. Delete the two files afterwards (`git status` clean for `data/catalog/` except `candidates.json`): the full survey in the operating procedure creates them for real.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add scripts/catalog-survey.js lib/cli-map.js test/catalog-survey-script.test.js test/*cli*.test.js
git commit -m "feat(catalog): read-only catalog survey with ASSIST, resume and catalog-check"
```

---

### Task 8: Review procedure, batch helper and the tracked-files check

**Files:**
- Create: `docs/CATALOG-REVIEW.md`
- Create: `scripts/catalog-batch.js`
- Test: `test/catalog-files.test.js`

**Interfaces:**
- Consumes: `loadCatalog`, `validateRecord` (Task 3); record files from Task 7.
- Produces: `node scripts/catalog-batch.js [--size 20]` prints the next unreviewed people-search records with their controls; a test that every tracked catalog record validates and holds no personal data.

- [ ] **Step 1: Write the failing test**

```js
// test/catalog-files.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateRecord, CATALOG_DIR } = require('../lib/catalog');

const files = fs.existsSync(CATALOG_DIR) ? fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && f !== 'candidates.json') : [];
const example = require('../config.example.json');
const person = example.person || (example.persons || [])[0] || {};
const pii = ['firstName', 'lastName', 'city', 'zip', 'phone', 'email', 'dob'].map(k => person[k]).filter(v => typeof v === 'string' && v.length >= 4);

test('every tracked catalog record validates', () => {
  for (const f of files) assert.equal(validateRecord(JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8')), f), null, f);
});

test('no catalog record holds personal values; email addresses only in survey.contacts', () => {
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
    const text = JSON.stringify({ ...rec, survey: { ...(rec.survey || {}), contacts: [] } });
    for (const v of pii) assert.ok(!text.includes(v), `${f} contains a config.example.json person value`);
    assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.-]+/, `${f} has an email address outside survey.contacts`);
  }
});

test('the batch helper and the review guide exist', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'catalog-batch.js')));
  const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CATALOG-REVIEW.md'), 'utf8');
  for (const s of ['ASSIST=1', 'catalog-batch', 'preview --only', 'needs-review', '{firstName}']) assert.ok(guide.includes(s), s);
});
```

Note on the email check: `survey.text` is page text and can contain the site's own address; the test blanks `contacts` only. If a real survey record trips it on `survey.text`, strip `mailto`-style addresses from `out.text` in `scripts/catalog-survey.js` (`.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')`) and add that replacement to Task 7's script, rather than loosening this test.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-files.test.js`
Expected: FAIL on the third test (files missing). The first two pass trivially while `data/catalog/` holds only `candidates.json`.

- [ ] **Step 3: Write the batch helper**

```js
#!/usr/bin/env node
// scripts/catalog-batch.js - print the next people-search records to review.
//
//   node scripts/catalog-batch.js [--size 20]
'use strict';
const path = require('path');
const { loadCatalog } = require(path.join(__dirname, '..', 'lib/catalog'));
const i = process.argv.indexOf('--size');
const size = i >= 0 ? Number(process.argv[i + 1]) : 20;
const batch = loadCatalog().filter(r => r.group === 'people-search' && (r.review || {}).state === 'unreviewed').slice(0, size);
for (const r of batch) {
  const s = r.survey || {};
  console.log(`\n${r.domain}  (${r.name})  ${s.optOutUrl || ''}  captcha=${!!s.captcha}${s.block ? ' block=' + s.block : ''}`);
  for (const c of s.controls || []) console.log(`  f${c.form} ${c.tag}/${c.type} id=${c.id} name=${c.name} ph="${c.placeholder}" label="${String(c.label || '').slice(0, 40)}" ${c.heading ? '[' + c.heading + ']' : ''}${c.options ? ' options=' + c.options.slice(0, 4).join('|') : ''}`);
  for (const b of s.buttons || []) if (b.inForm) console.log(`  button "${b.text}"`);
}
console.log(`\n${batch.length} record(s) in this batch.`);
```

- [ ] **Step 4: Write `docs/CATALOG-REVIEW.md`**

```markdown
# Reviewing the site catalog

The catalog (`data/catalog/`) holds one record per site from the generic lists. A record only runs once it is **reviewed**. This is the procedure.

## 1. Candidates and the first survey

    node scripts/catalog-candidates.js
    node scripts/catalog-survey.js            (headless, read-only, Mullvad on; resumable with --resume)

Each site is grouped: dead, blocked, people-search, business or unknown.

## 2. The assisted sitting

    ASSIST=1 WAIT=8000 node scripts/catalog-survey.js --group blocked

A window opens for each blocked site. Complete the bot check; the survey records the page and moves on. It never clicks, types or submits anything for you.

## 3. Review batches

    node scripts/catalog-batch.js --size 20

For each site in the batch, edit its record's `review`:

- `"state": "reviewed"` with a `definition` (method, optOutUrl, formFields, submitSelector, captchaLikely, requires), or
- `"state": "manual"` with `optOutUrl` and `notes` when a person has to do it, or
- `"state": "excluded"` when the site is not about individuals.

Values are tokens: `{firstName}`, `{lastName}`, `{fullName}`, `{email}`, `{city}`, `{state}`, `{stateName}`, `{zip}`, `{dobMonthName}`, `{dobDay}`, `{dobYear}`. The only literals allowed are `on` and option values the survey recorded for a dropdown. Never type a real value.

Rules learned from the 2026-10 surveys:

- Fill only the opt-out form. Scope selectors to it when the page has more than one form (`form:has(button:has-text("Send Request")) ...`).
- Never fill a header search box, a newsletter box or a marketing signup.
- Tick consent or authorisation boxes only when the request needs them; never promotional ones.
- Two-step sites (an emailed link opens the real form) fill only step one.
- A form that needs a birth date lists `"requires": ["dob"]`.
- An embedded third-party form whose required fields cannot be reached becomes `manualAfterSearch` or `manual`.

## 4. Prove the batch

    node bin/aidr.js preview --only "Site One,Site Two"

A record stays `reviewed` only if its preview fills the intended fields and names the submit target. Otherwise make it `manual` or put it back to `unreviewed` with a note. Then run `npm test` (every record must validate and hold no personal data) and commit the batch.

## 5. Keeping it current

    node bin/aidr.js catalog-check

Re-checks reviewed sites. A site whose page moved, lost a field or gained a bot check becomes `needs-review` and runs as manual until it is reviewed again.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-files.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`
Expected: all pass.

```bash
git add docs/CATALOG-REVIEW.md scripts/catalog-batch.js test/catalog-files.test.js
git commit -m "docs(catalog): review procedure, batch helper, tracked-record checks"
```

---

## After the plan: operating the catalog (not code tasks)

These follow `docs/CATALOG-REVIEW.md` and happen with the member, after the final review of this branch:

1. `aidr update-brokers` (if Task 1 found working registry URLs), then `node scripts/catalog-candidates.js`.
2. The headless survey of every candidate (1 to 3 hours, resumable).
3. The member's assisted sitting over `--group blocked`.
4. Review batches of about 20 people-search sites, each shown to the member with its preview results before commit.
5. Phase 2 gets its own spec.
