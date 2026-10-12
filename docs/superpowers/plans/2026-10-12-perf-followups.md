# Performance and Review Follow-ups (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining performance and follow-up findings from the 2026-10-12 review, except the watcher split (Plan B) and the items measured as not worth it.

**Architecture:** Small, local changes, each test-first: a TTL cache for the dashboard's catalog read, one SERP-history reader, a suffix-aware `registrableDomain`, three right-to-know/email fixes, two egress-loop fixes, extra tests, and text fixes.

**Tech Stack:** Node.js 20+ (CommonJS), Playwright 1.60, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-12-perf-followups-design.md`

## Global Constraints

- Branch: `upec/perf-followups` (created off local `upec/hardening` at 90f300f). Never push; never force-push.
- Read `CLAUDE.md` first. Never run `setup.js`, `upec-wipe run`, `--email`, `--know` or `preview` with the real config. Never read, print, copy or commit `config.json`, `config.json.enc`, `state.json`, `logs/`, `secrets/`.
- Tests use the dummy person (Jane Doe, Austin TX, `jane.doe@example.com`). No real personal data anywhere.
- Plain hyphens only: no em dash (U+2014) or en dash (U+2013) in tracked files. No emoji (Extended_Pictographic) in non-test JS (`test/no-emoji-output.test.js`).
- Full suite: `npm test` (about 80 s). Dashboard tests: `node --test dashboard/*.test.js`. If only `test/cli-dashboard-boot.test.js` fails under load, re-run it alone.
- Single test file: `node --require ./test/helpers/egress-off.js --test test/<file>.test.js`
- Commit messages end with a `Co-Authored-By:` trailer naming the model that wrote the commit.
- Privacy rules are the product: the real email is never sent anywhere; nothing leaves the machine off the VPN.

## Review Focus

- A catalog record edited while the dashboard is open shows up within a minute (TTL is 60 s, not forever). Pinned in Task 1.
- `registrableDomain` on a bare suffix itself (`co.uk`) still returns `co.uk`, so the catalog keeps rejecting it as a domain. Pinned in Task 3.
- `--know` with no email block must not contact SimpleLogin at all. Pinned in Task 4 (source order test).
- A VPN drop at the very start of the generic pass (first broker) is caught. Pinned in Task 5.
- Two persons in one run: the explicit loop still re-checks every 10 brokers across the person boundary. Pinned in Task 5 (source test).

---

### Task 1: Dashboard catalog cache

**Files:**
- Modify: `lib/catalog.js` (add `cachedCatalogLoader`, export it)
- Modify: `dashboard/server.js` (`/api/brokers` handler; one module-level line)
- Test: create `test/catalog-cache.test.js`

**Interfaces:**
- Produces: `cachedCatalogLoader({ ttlMs = 60000, load, now } = {}) -> () => records[]`.

- [ ] **Step 1: Write the failing tests**

Create `test/catalog-cache.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cachedCatalogLoader } = require('../lib/catalog');

test('the catalog is read once per TTL', () => {
  let t = 0;
  let reads = 0;
  const get = cachedCatalogLoader({ ttlMs: 60000, now: () => t, load: () => { reads++; return [{ domain: `r${reads}.example` }]; } });
  assert.equal(get()[0].domain, 'r1.example');
  t += 59999;
  assert.equal(get()[0].domain, 'r1.example');
  assert.equal(reads, 1);
  t += 1;
  assert.equal(get()[0].domain, 'r2.example');
  assert.equal(reads, 2);
});

test('the dashboard reads the catalog through the cache', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'server.js'), 'utf8');
  assert.match(src, /cachedCatalogLoader\(/);
  assert.ok(!/loadCatalog\(/.test(src), 'server.js must not read the catalog directly');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-cache.test.js`
Expected: FAIL (`cachedCatalogLoader is not a function`).

- [ ] **Step 3: Implement**

In `lib/catalog.js`, after `loadCatalog`, add and export:

```js
// Reading the catalog costs seconds on a slow disk (641 files), and the
// dashboard asks for it on every /api/brokers call. Re-read at most once per ttlMs.
function cachedCatalogLoader({ ttlMs = 60000, load = () => loadCatalog(undefined, () => {}), now = Date.now } = {}) {
  let records = null;
  let at = 0;
  return () => {
    if (!records || now() - at >= ttlMs) {
      records = load();
      at = now();
    }
    return records;
  };
}
```

In `dashboard/server.js`, after the other top-level `require` lines add:

```js
// The site catalog is 641 files (seconds on a slow disk): read it at most once a minute.
const getCatalogRecords = require('../lib/catalog').cachedCatalogLoader();
```

In the `/api/brokers` handler replace

```js
    const { loadCatalog, catalogSummary, catalogEmailTargets } = require('../lib/catalog');
    const records = loadCatalog(undefined, () => {});
```

with

```js
    const { catalogSummary, catalogEmailTargets } = require('../lib/catalog');
    const records = getCatalogRecords();
```

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/catalog-cache.test.js test/catalog.test.js` then `node --test dashboard/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/catalog.js dashboard/server.js test/catalog-cache.test.js
git commit -m "perf(dashboard): read the site catalog at most once a minute"
```

---

### Task 2: One SERP-history reader

**Files:**
- Modify: `watcher.js` (`--score` block and `--report` block)
- Test: create `test/watcher-serp-history.test.js`

**Interfaces:**
- Consumes: `readHistory() -> Array` from `lib/serp-scan.js` (already exported; returns `[]` on a missing, unreadable or non-array file; reads `data/serp-history.json`).

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('watcher reads the SERP history only through serp-scan readHistory()', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');
  assert.ok(!/serp-history\.json'\)/.test(src), 'no hand-built serp-history.json path');
  assert.equal((src.match(/readHistory\(\)/g) || []).length, 2);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --require ./test/helpers/egress-off.js --test test/watcher-serp-history.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the `--score` block replace

```js
  let serpRows = [];
  const serpHistoryPath = path.join(__dirname, 'data', 'serp-history.json');
  try {
    serpRows = JSON.parse(fs.readFileSync(serpHistoryPath, 'utf8'));
    if (!Array.isArray(serpRows)) serpRows = [];
  } catch (_) { serpRows = []; }
  const serpResults = serpResultsFromHistory(serpRows);
```

with

```js
  const serpResults = serpResultsFromHistory(require('./lib/serp-scan').readHistory());
```

In the `--report` block replace

```js
  let serpRowsForReport = [];
  try {
    const serpHistoryPathForReport = path.join(__dirname, 'data', 'serp-history.json');
    serpRowsForReport = JSON.parse(fs.readFileSync(serpHistoryPathForReport, 'utf8'));
    if (!Array.isArray(serpRowsForReport)) serpRowsForReport = [];
  } catch (_) { serpRowsForReport = []; }
  const serpResultsForReport = serpResultsFromHistory(serpRowsForReport);
```

with

```js
  const serpResultsForReport = serpResultsFromHistory(require('./lib/serp-scan').readHistory());
```

Keep the comment line above each block. The line `console.log('   New domains are printed below and recorded in data/serp-history.json.\n');` stays (it is output text, not a path).

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/watcher-serp-history.test.js test/exposure-format-score.test.js test/report-exposure-trend.test.js`, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher-serp-history.test.js
git commit -m "refactor(watcher): read SERP history through serp-scan readHistory"
```

---

### Task 3: `registrableDomain` knows two-label suffixes

**Files:**
- Modify: `lib/domain.js` (add `BARE_SUFFIXES`, change `registrableDomain`, export)
- Modify: `lib/catalog-sources.js` (import `BARE_SUFFIXES` from `./domain` instead of defining it; keep exporting it)
- Test: `test/domain.test.js`, `test/catalog-sources.test.js`

**Interfaces:**
- Produces: `lib/domain.js` exports `{ hostnameOf, registrableDomain, BARE_SUFFIXES }`. `lib/catalog-sources.js` still exports `BARE_SUFFIXES` (same Set object).

- [ ] **Step 1: Write the failing tests**

Append to `test/domain.test.js`:

```js
test('registrableDomain keeps three labels under a two-label public suffix', () => {
  assert.equal(registrableDomain('www.broker.co.uk'), 'broker.co.uk');
  assert.equal(registrableDomain('broker.co.uk'), 'broker.co.uk');
  assert.equal(registrableDomain('a.b.example.com.au'), 'example.com.au');
  assert.equal(registrableDomain('co.uk'), 'co.uk');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('localhost'), 'localhost');
});

test('catalog-sources uses the same suffix list as lib/domain', () => {
  assert.equal(require('../lib/catalog-sources').BARE_SUFFIXES, require('../lib/domain').BARE_SUFFIXES);
});
```

In `test/catalog-sources.test.js`, in `explicit brokers, dead hosts and bare public suffixes are dropped`, change the row `{ name: 'U', url: 'https://broker.co.uk/', source: 'markup' }` to `{ name: 'U', url: 'https://co.uk/', source: 'markup' }` (a bare suffix is still dropped). Add after that test:

```js
test('a broker under a two-label suffix keeps its own domain', () => {
  const c = buildCandidates({ rows: [{ name: 'U', url: 'https://www.broker.co.uk/optout', source: 'markup' }] });
  assert.deepEqual(c.map(x => x.domain), ['broker.co.uk']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/domain.test.js test/catalog-sources.test.js`
Expected: FAIL (`co.uk` returned for `www.broker.co.uk`).

- [ ] **Step 3: Implement**

In `lib/domain.js`, above `registrableDomain`:

```js
// Two-label public suffixes: a registrable domain under them keeps three labels.
const BARE_SUFFIXES = new Set(['co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'co.za', 'com.br', 'co.jp']);
```

Replace the body of `registrableDomain` with:

```js
  if (!hostname) return '';
  const parts = hostname.split('.');
  if (parts.length >= 3 && BARE_SUFFIXES.has(parts.slice(-2).join('.'))) return parts.slice(-3).join('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
```

Update its comment/JSDoc to say it handles the listed two-label suffixes (not the full public suffix list). Update the file header sentence "it does not know multi-part suffixes such as co.uk" to "it knows only the two-label suffixes in BARE_SUFFIXES". Export: `module.exports = { hostnameOf, registrableDomain, BARE_SUFFIXES };`.

In `lib/catalog-sources.js` delete the `const BARE_SUFFIXES = new Set([...]);` line and change the domain require to `const { hostnameOf, registrableDomain, BARE_SUFFIXES } = require('./domain');`. Its `module.exports` keeps `BARE_SUFFIXES`.

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/domain.test.js test/catalog-sources.test.js test/catalog*.test.js test/imap-confirm.test.js test/serp-scan.test.js test/feeds-*.test.js test/generic-runner-*.test.js`, then `npm test`.
Expected: PASS. If `test/catalog-files.test.js` now rejects a committed record, stop and report it (do not edit `data/catalog/`).

- [ ] **Step 5: Commit**

```bash
git add lib/domain.js lib/catalog-sources.js test/domain.test.js test/catalog-sources.test.js
git commit -m "fix(domain): registrableDomain keeps broker.co.uk instead of co.uk"
```

---

### Task 4: Email and right-to-know follow-ups

**Files:**
- Modify: `lib/email-step.js` (`confirmAndSend` default `rerun`)
- Modify: `lib/right-to-know-runner.js` (`buildKnowPlan`, `runKnowStep`)
- Modify: `watcher.js` (`--know` block: setup check before `buildSubmissionPlan`)
- Test: `test/right-to-know-step.test.js`, `test/email-run-step.test.js`, `test/watcher-know-step.test.js`

**Interfaces:**
- Consumes: `checkEmailSetup({ config, persons, isTTY, preview }) -> string|null` (`lib/email-step.js`).
- Produces: `buildKnowPlan({ ..., manual? })`: when `manual` (an array) is given, brokers moved to manual are pushed as `{ name, to }`. Return value unchanged (items array). `confirmAndSend` default `rerun` is `'upec-wipe run --email'`; `runKnowStep` passes `'upec-wipe know'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/right-to-know-step.test.js`:

```js
test('a know address that failed twice goes to manual and is not sent', async () => {
  const state = { optOuts: {}, emailFailures: { [`${KNOW_PREFIX}Pipl`]: 2 } };
  const { d, out } = deps({ state });
  assert.equal(await runKnowStep(d), 0);
  assert.equal(out.sent.length, 0);
  assert.match(out.lines.join('\n'), /manual Pipl: right-to-know email to privacy@pipl\.com failed or bounced/);
});

test('a bounced know address goes to manual', () => {
  const manual = [];
  const state = { emailReplies: { [`${KNOW_PREFIX}Pipl`]: { outcome: 'bounced', at: 't' } } };
  const items = buildKnowPlan({ brokers: BROKERS, persons: [P], state, submissionEmailFor: () => ALIAS, blockedPersons: new Set(), maxPerRun: 100, manual });
  assert.deepEqual(items, []);
  assert.deepEqual(manual, [{ name: 'Pipl', to: 'privacy@pipl.com' }]);
});

test('two brokers sharing one address get one request per person', () => {
  const brokers = [...BROKERS, { name: 'PiplToo', method: 'email', emailTo: 'privacy@PIPL.com' }];
  const items = buildKnowPlan({ brokers, persons: [P], state: {}, submissionEmailFor: () => ALIAS, blockedPersons: new Set(), maxPerRun: 100 });
  assert.deepEqual(items.map(i => i.name), ['Pipl']);
});

test('a stopped know run names the real command to re-run', async () => {
  const err = Object.assign(new Error('connect failed'), { code: 'ECONNECTION' });
  const { d, out } = deps({ makeTransport: () => ({ sendMail: async () => { throw err; } }) });
  assert.equal(await runKnowStep(d), 1);
  assert.match(out.lines.join('\n'), /run upec-wipe know again/);
});
```

Append to `test/email-run-step.test.js`:

```js
test('a stopped email run names the real command to re-run', async () => {
  const err = Object.assign(new Error('connect failed'), { code: 'ECONNECTION' });
  const { d, out } = deps({ makeTransport: () => ({ sendMail: async () => { throw err; } }) });
  assert.equal(await runEmailStep(d), 1);
  assert.match(out.lines.join('\n'), /run upec-wipe run --email again/);
});
```

Append to `test/watcher-know-step.test.js`:

```js
test('--know checks the email setup before it can create a SimpleLogin alias', () => {
  const block = src.slice(src.indexOf('if (KNOW_MODE) {'), src.indexOf('const code = await runKnowStep('));
  const check = block.indexOf('checkEmailSetup(');
  assert.ok(check > 0, 'checkEmailSetup is called in the --know block');
  assert.ok(check < block.indexOf('buildSubmissionPlan('), 'and before buildSubmissionPlan');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/right-to-know-step.test.js test/email-run-step.test.js test/watcher-know-step.test.js`
Expected: FAIL (no manual line, two items for the shared address, `--know again` text, no setup check in watcher).

- [ ] **Step 3: Implement**

In `lib/email-step.js`, in the `confirmAndSend` signature change `rerun = '--email'` to `rerun = 'upec-wipe run --email'`.

In `lib/right-to-know-runner.js` replace `buildKnowPlan` with:

```js
function buildKnowPlan({ brokers, persons, state, submissionEmailFor, blockedPersons, maxPerRun, manual }) {
  const sent = (state && state.emailSent) || {};
  const optOuts = (state && state.optOuts) || {};
  const failures = (state && state.emailFailures) || {};
  const replies = (state && state.emailReplies) || {};
  const addressesByPerson = new Map();
  const items = [];
  for (const broker of (brokers || []).filter(b => b.method === 'email' && b.emailTo)) {
    const to = String(broker.emailTo).trim().toLowerCase();
    for (const person of persons || []) {
      if (blockedPersons && blockedPersons.has(person)) continue;
      // No resolved address: fail closed, never the real email.
      const address = submissionEmailFor(person);
      if (!address) continue;
      // One request per broker address per person, like the --email step.
      const seen = addressesByPerson.get(person) || new Set();
      addressesByPerson.set(person, seen);
      if (seen.has(to)) continue;
      seen.add(to);
      const sk = stateKey(broker.name, person, persons.length);
      const key = KNOW_PREFIX + sk;
      if (sent[key]) continue;
      // Recorded by the old sender (SMTP or printed template): already asked.
      if (optOuts[sk] && optOuts[sk].knowRequestedAt) continue;
      // Two failed sends or a logged bounce: a person has to check the address.
      if ((failures[key] || 0) >= 2 || (replies[key] && replies[key].outcome === 'bounced')) {
        if (manual) manual.push({ name: broker.name, to });
        continue;
      }
      const { subject, body } = buildKnowRequest({ person: { ...person, email: address }, broker });
      items.push({ key, name: broker.name, to, basis: null, subject, body, person });
    }
  }
  return items.slice(0, maxPerRun);
}
```

In `runKnowStep` replace

```js
  const items = buildKnowPlan({ ...deps, maxPerRun });
```

with

```js
  const manual = [];
  const items = buildKnowPlan({ ...deps, maxPerRun, manual });
  for (const m of manual) log(`  manual ${m.name}: right-to-know email to ${m.to} failed or bounced - check the address and send by hand`);
```

and change `rerun: '--know',` to `rerun: 'upec-wipe know',`.

In `watcher.js`, in the `--know` async block, insert as the first statements (before `const plan = await buildSubmissionPlan(`):

```js
    // Check the mailbox setup first: a run that will be refused must not
    // create a SimpleLogin alias.
    const { checkEmailSetup } = require('./lib/email-step');
    const setupProblem = checkEmailSetup({ config, persons, isTTY: !!process.stdin.isTTY, preview: DRY_RUN });
    if (setupProblem) {
      console.log(`Right-to-know not sent: ${setupProblem}.`);
      return 1;
    }
```

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `npm test`.
Expected: PASS. If an existing test pins the old "run --email again" or "run --know again" text, update it to the new command text.

- [ ] **Step 5: Commit**

```bash
git add lib/email-step.js lib/right-to-know-runner.js watcher.js test/right-to-know-step.test.js test/email-run-step.test.js test/watcher-know-step.test.js
git commit -m "fix(know): manual after failures, one request per address, setup check before the alias"
```

---

### Task 5: Egress loop follow-ups

**Files:**
- Modify: `generic-runner.js` (recheck condition in `runGenericBrokers`)
- Modify: `watcher.js` (explicit-loop counter placement; generic-pass EgressError handling)
- Test: `test/generic-runner-egress.test.js`, `test/watcher-egress-wiring.test.js`

- [ ] **Step 1: Write the failing tests**

In `test/generic-runner-egress.test.js`, in the test `the generic pass re-checks egress every 10 brokers and stops when it fails`, rename it to `the generic pass re-checks egress before its first broker and every 10 after, and stops when it fails`, and change its last two asserts to:

```js
  assert.equal(checks, 2);
  assert.equal(seen.length, 10);
```

Append:

```js
test('the first re-check runs before any broker is visited', async () => {
  const brokers = Array.from({ length: 25 }, (_, i) => ({ name: `B${i}`, url: `https://b${i}.example/` }));
  const events = [];
  const context = { newPage: async () => ({ close: async () => {}, waitForTimeout: async () => {} }) };
  await runGenericBrokers(context, new Set(), { optOuts: {} }, () => {}, () => {}, {
    injectedBrokers: brokers,
    injectedProcessFn: async (_page, b) => { events.push(b.name); return { status: 'manual', detail: '' }; },
    recheckEgress: async () => { events.push('check'); },
  });
  assert.equal(events[0], 'check');
  assert.equal(events[11], 'check');
  assert.equal(events.filter(e => e === 'check').length, 3);
});
```

Append to `test/watcher-egress-wiring.test.js`:

```js
test('the explicit-loop re-check counter runs across persons', () => {
  const counter = src.indexOf('let sinceCheck = 0;');
  assert.ok(counter > 0);
  assert.ok(counter < src.indexOf('for (const { person, email: submissionEmail, masked } of plan.allowed)'));
});

test('a VPN drop in the generic pass stops the run cleanly', () => {
  const block = src.slice(src.indexOf('await runGenericBrokers(context'), src.indexOf('results.genericStats = genericTotals'));
  assert.match(block, /instanceof EgressError/);
  assert.match(block, /saveState\(\)/);
  assert.match(block, /process\.exitCode = 1/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-runner-egress.test.js test/watcher-egress-wiring.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `generic-runner.js` change

```js
        if (opts.recheckEgress && stats.attempted > 0 && stats.attempted % EGRESS_RECHECK_EVERY === 0) {
```

to

```js
        // Before the first broker too: the pass can start long after the launch check.
        if (opts.recheckEgress && stats.attempted % EGRESS_RECHECK_EVERY === 0) {
```

In `watcher.js`:
- Delete the line `    let sinceCheck = 0;` inside the explicit loop, and add directly above `  for (const { person, email: submissionEmail, masked } of plan.allowed) {`:

```js
  // Counts brokers across persons, so a person boundary never skips a re-check.
  let sinceCheck = 0;
```

- In the generic pass replace

```js
      const genericResult = await runGenericBrokers(context, explicitHosts, state, logResult, recordSuccess, {
        dryRun: DRY_RUN,
        person: withSubmissionEmail(person, email),
        personCount: persons.length,
        recheckEgress: session.recheckEgress,
      });
```

with

```js
      let genericResult;
      try {
        genericResult = await runGenericBrokers(context, explicitHosts, state, logResult, recordSuccess, {
          dryRun: DRY_RUN,
          person: withSubmissionEmail(person, email),
          personCount: persons.length,
          recheckEgress: session.recheckEgress,
        });
      } catch (err) {
        // Same clean stop as the explicit loop: nothing more is submitted.
        if (!(err instanceof EgressError)) throw err;
        console.error(`\n${err.message}`);
        saveState();
        await session.close();
        process.exitCode = 1;
        return;
      }
```

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `npm test`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add generic-runner.js watcher.js test/generic-runner-egress.test.js test/watcher-egress-wiring.test.js
git commit -m "fix(egress): re-check at the start of the generic pass and stop it cleanly"
```

---

### Task 6: Test hardening

No production code changes. Each test must pass against the current code; if one fails, stop and report it as a bug (do not change production code in this task).

**Files:**
- Test: `test/right-to-know-step.test.js`, `test/email-run-step.test.js`, `test/node-egress.test.js`

- [ ] **Step 1: Add the tests**

Append to `test/right-to-know-step.test.js`:

```js
test('a failing egress gate sends nothing', async () => {
  const { EgressError } = require('../lib/egress');
  const { d, out } = deps({ ensureEgress: async () => { throw new EgressError('off'); } });
  await assert.rejects(() => runKnowStep(d), EgressError);
  assert.equal(out.sent.length, 0);
  assert.equal(out.transports, 0);
});
```

Append to `test/email-run-step.test.js`:

```js
test('a resend cut by the cap stays unknown for the next run', async () => {
  const state = { optOuts: {}, emailSent: {
    Alpha: { to: 'p@alpha.com', at: 't', status: 'unknown' },
    Beta: { to: 'p@beta.com', at: 't', status: 'unknown' },
  } };
  const two = [...targets, { name: 'Beta', domain: 'beta.com', to: 'p@beta.com', basis: null }];
  const cfg = { email: { ...config.email, maxPerRun: 1 } };
  const { d, out } = deps({ config: cfg, state, targets: two, ask: async q => (/Resend/.test(q) ? 'y' : 'SEND') });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 1);
  assert.equal(state.emailSent.Alpha.messageId, 'x');
  assert.equal(state.emailSent.Beta.status, 'unknown');
  assert.equal(state.emailSent.Beta.assumed, undefined);
});
```

Append to `test/node-egress.test.js`:

```js
test('two calls while a check is pending share one fetch', async () => {
  egress._resetNodeEgress();
  let calls = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  egress.setEgressConfig({}, { fetchJson: async () => { calls++; await gate; return { mullvad_exit_ip: true }; } });
  const a = egress.ensureNodeEgress();
  const b = egress.ensureNodeEgress();
  release();
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});

test('a failure stays cached past the TTL', async () => {
  egress._resetNodeEgress();
  let t = 0;
  let calls = 0;
  egress.setEgressConfig({}, { fetchJson: async () => { calls++; return { mullvad_exit_ip: false }; }, now: () => t });
  await assert.rejects(() => egress.ensureNodeEgress(), EgressError);
  t += egress.NODE_EGRESS_TTL_MS * 2;
  await assert.rejects(() => egress.ensureNodeEgress(), EgressError);
  assert.equal(calls, 1);
});
```

- [ ] **Step 2: Run them**

Run: `node --require ./test/helpers/egress-off.js --test test/right-to-know-step.test.js test/email-run-step.test.js test/node-egress.test.js`
Expected: PASS (these pin existing behaviour).

- [ ] **Step 3: Commit**

```bash
git add test/right-to-know-step.test.js test/email-run-step.test.js test/node-egress.test.js
git commit -m "test: pin know egress failure, resend cap state and egress cache behaviour"
```

---

### Task 7: Small text fixes

**Files:**
- Modify: `watcher.js` (`PREVIEW_ALIAS_NOTE`), `test/dob.test.js` (header), `lib/captcha.js` (result URL constant), `generic-runner.js` (header order)

- [ ] **Step 1: Make the edits**

- `watcher.js`: replace the `PREVIEW_ALIAS_NOTE` value with
  ``const PREVIEW_ALIAS_NOTE = `Note: no SimpleLogin alias exists yet, so this preview uses ${PREVIEW_ALIAS} as a stand-in. A real run creates the alias.`;``
- `test/dob.test.js` header: replace `reached Spokeo and Pipl): emailed opt-outs carry the alias alone.` with `reached Spokeo and Pipl). Emailed requests go through lib/email-step.js and are tested there.`
- `lib/captcha.js`: move `const CAPSOLVER_CREATE_URL = 'https://api.capsolver.com/createTask';` up to just below the `require('./egress')` line, add next to it `const CAPSOLVER_RESULT_URL = 'https://api.capsolver.com/getTaskResult';`, and in `pollCapSolver` replace the literal `'https://api.capsolver.com/getTaskResult'` with `CAPSOLVER_RESULT_URL`.
- `generic-runner.js` header: move the line ` *   4. If nothing automatable → manual list` up so it directly follows ` *      c. DSAR / data request link → manual list`, with the three "Cookie-consent managers are not used..." lines after it.

- [ ] **Step 2: Run the tests**

Run: `grep -rn "Preview: no SimpleLogin" test/ watcher.js` (expect no hits), then `npm test`.
Expected: PASS. If a test pinned the old note text, update it to the new text.

- [ ] **Step 3: Commit**

```bash
git add watcher.js test/dob.test.js lib/captcha.js generic-runner.js
git commit -m "chore: preview note wording, captcha URL constants, header tidy-ups"
```
