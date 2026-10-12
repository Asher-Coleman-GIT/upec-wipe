# Review Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close six privacy gaps found in the 2026-10-12 review, remove two slow paths, and delete or merge dead and duplicated code, with the suite green after every task.

**Architecture:** Each fix is test-first and local to one module, with a small wiring change in `watcher.js`. The right-to-know path is rebuilt on top of the existing `lib/email-step.js` sender instead of keeping a second sender. Pure refactors (captcha, domain helpers) are guarded by the existing tests.

**Tech Stack:** Node.js 20+ (CommonJS), Playwright 1.60, `node:test`, nodemailer (optional dep), axios.

**Spec:** `docs/superpowers/specs/2026-10-12-review-overhaul-design.md`

## Global Constraints

- Branch: `upec/review-overhaul` (already created off `upec/hardening` at 84b13a7). Never push to `upec/hardening`; never force-push.
- Read `CLAUDE.md` first. Never run `setup.js`, `upec-wipe run`, `--email`, `--know` or `preview` with the real config. Never read, print, copy or commit `config.json`, `config.json.enc`, `state.json`, `logs/`, `secrets/`.
- Tests use the dummy person (Jane Doe, Austin TX, `jane.doe@example.com`). No real personal data in any file, test, commit message or PR text.
- Plain hyphens only: no em dash (U+2014) or en dash (U+2013) anywhere (`test/no-em-dashes.test.js`). No emoji in output.
- Full suite: `npm test` (about 85 s). Dashboard tests: `node --test dashboard/*.test.js`. `test/cli-dashboard-boot.test.js` can time out under full-suite load; re-run it alone before treating it as a failure.
- Single test file: `node --require ./test/helpers/egress-off.js --test test/<file>.test.js`
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Dated documents under `docs/superpowers/` and `docs/plans/` other than this plan and its spec are historical: do not edit them.

## Review Focus

- An existing member config with no `relay` block now blocks every person: the run must say why and how to fix it (P1 error text names `relay.required` false as the explicit opt-out). Pinned in Task 2.
- A Mullvad drop in the middle of a long forms run must stop the run, not just the next Node call. Pinned in Task 4 (browser recheck, both loops).
- `--know` and `--email` sharing `state.emailSent` must not mark each other's brokers as sent. Pinned in Task 6 (`know:` prefix test).
- `--know` with no `email` block used to print templates; now it refuses with the setup message. The manual must say so. Pinned in Task 6 (manual row).
- The combined Do Not Sell locator must still skip hidden matches. Pinned in Task 9 (browser test, run with `UPEC_WIPE_BROWSER_TESTS=1`).

---

### Task 1: Delete the unused opt-out email sender

`lib/email.js` `sendOptOutEmails` is never called in production (`test/watcher-email-flags.test.js` asserts watcher does not call it). Opt-out emails go through `lib/email-step.js`.

**Files:**
- Modify: `lib/email.js` (keep only `UCPA_SUBJECT`, `buildUcpaRequest`, `smtpTransportOptions`)
- Delete: `test/email.test.js`, `test/email-key-drift.test.js`, `test/email-multi-person.test.js`, `test/email-relay.test.js`, `test/email-plan-wiring.test.js`
- Modify: `test/dob.test.js` (remove the emailed opt-out section), `test/node-egress.test.js` (remove one test)

**Interfaces:**
- Produces: `lib/email.js` exports exactly `{ buildUcpaRequest, smtpTransportOptions }`.

- [ ] **Step 1: Confirm nothing in production uses the code being removed**

Run: `grep -rn "sendOptOutEmails\|_pickTemplate\|require('./email')\|require('./lib/email')" --include=*.js lib watcher.js generic-runner.js dashboard bin setup.js scripts`
Expected: only `require('./email')` / `require('./lib/email')` lines that destructure `smtpTransportOptions` or `buildUcpaRequest`, plus a comment in `lib/submission-plan.js`.

- [ ] **Step 2: Rewrite `lib/email.js`**

Replace the file with the header below, followed by the existing `UCPA_SUBJECT` constant, the existing `buildUcpaRequest` function with its JSDoc, and the existing `smtpTransportOptions` function with its JSDoc, copied unchanged. Remove `EU_COUNTRIES`, `_buildBodyGDPR`, `_buildBodyCCPA`, `_buildBody`, `_pickTemplate`, `_sendViaSMTP`, `_getPersons`, `sendOptOutEmails` and every `require` the kept code does not use.

```js
/**
 * lib/email.js
 *
 * Email helpers for the --email and --know steps (lib/email-step.js,
 * lib/right-to-know-runner.js): the Utah request letter and the nodemailer
 * transport options. Sending lives in lib/email-step.js.
 */

const { normalizeUsState, usStateName } = require('./us-state');
```

End the file with:

```js
module.exports = {
  buildUcpaRequest,
  smtpTransportOptions,
};
```

Also update the stale comment in `lib/submission-plan.js` (the JSDoc above `submissionOptions`): replace `(sendOptOutEmails, sendKnowRequests)` with `(the --know step)`.

- [ ] **Step 3: Delete the tests that only cover the removed sender**

```bash
git rm test/email.test.js test/email-key-drift.test.js test/email-multi-person.test.js test/email-relay.test.js test/email-plan-wiring.test.js
```

In `test/dob.test.js` delete everything from the line `// ── email opt-outs` to the end of the test named `the real email never appears in an emailed opt-out, even with the old removeRealEmail flag set` (the `SMTP_CFG`, `BROKER`, `ALIAS` constants, the `send()` helper and that test). If `Module` is then unused, remove `const Module = require('module');`.

In `test/node-egress.test.js` delete the test `SMTP opt-out email: failing gate means sendMail is never called`. Keep `stubNodemailer` (Task 6 removes it).

- [ ] **Step 4: Run the suite**

Run: `grep -ln "lib/email'" test/*.js` and check each file listed uses only `buildUcpaRequest` or `smtpTransportOptions` from it.
Run: `npm test`
Expected: PASS, 0 fail (the test count drops by the deleted tests).

- [ ] **Step 5: Commit**

```bash
git add -A lib/email.js lib/submission-plan.js test/
git commit -m "refactor(email): delete the unused opt-out email sender

sendOptOutEmails was never called in production: opt-out emails go
through lib/email-step.js. Keep buildUcpaRequest and smtpTransportOptions.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The relay fails closed by default (P1)

Today `getSubmissionEmail` returns the real email when there is no `relay` block or `required` is missing. The fork rule is that a missing alias blocks the person.

**Files:**
- Modify: `lib/relay.js` (`relayRequired`, the two `RelayUnavailableError` messages in `getSubmissionEmail`, the file header comment)
- Modify: `watcher.js` (the `else console.log('   Warning: No relay configured...')` line in the per-person loop)
- Test: `test/relay.test.js`, `test/submission-plan.test.js`
- Docs: `docs/UPEC-MANUAL.md` (troubleshooting row), `docs/relay.md` (step 4)

**Interfaces:**
- Produces: `relayRequired(config) -> boolean` is `true` unless `config.relay.required === false`.

- [ ] **Step 1: Write the failing tests**

In `test/relay.test.js` replace the test `no relay configured returns person.email unchanged` with:

```js
test('no relay block blocks the person instead of using the real email', async () => {
  let createCalls = 0;
  const createImpl = async () => { createCalls += 1; return 'x@aliases.test'; };
  await assert.rejects(
    () => getSubmissionEmail({ config: {}, person: PERSON_A, state: makeState(), createImpl }),
    (err) => err instanceof RelayUnavailableError && /relay\.required to false/.test(err.message)
  );
  assert.equal(createCalls, 0);
});

test('relay.required false with no relay returns person.email unchanged', async () => {
  const state = makeState();
  let createCalls = 0;
  const createImpl = async () => { createCalls += 1; return 'should-not-be-used@aliases.test'; };
  const out = await getSubmissionEmail({ config: { relay: { required: false } }, person: PERSON_A, state, createImpl });
  assert.equal(out, 'jane.doe@example.com');
  assert.equal(createCalls, 0);
  assert.equal(state.relayAliases, undefined);
});
```

In the test `relay configured but missing apiKey falls back to person.email`, change its config to `{ relay: { provider: 'simplelogin', required: false } }` and rename it `relay.required false and no apiKey falls back to person.email`. Add after it:

```js
test('relay with no apiKey and no required key blocks the person', async () => {
  await assert.rejects(
    () => getSubmissionEmail({ config: { relay: { provider: 'simplelogin' } }, person: PERSON_A, state: makeState() }),
    RelayUnavailableError
  );
});
```

In the test `relayConfigured / relayRequired`, replace the three `relayRequired` asserts with:

```js
  assert.equal(relayRequired({ relay: { required: true } }), true);
  assert.equal(relayRequired({ relay: { required: 'yes' } }), true);
  assert.equal(relayRequired({}), true);
  assert.equal(relayRequired(undefined), true);
  assert.equal(relayRequired({ relay: { required: false } }), false);
```

Also update the header comment items 1 and 2 at the top of `test/relay.test.js` to: `1. getSubmissionEmail - no relay -> RelayUnavailableError unless relay.required is false` and `2. getSubmissionEmail - relay.required false -> returns person.email`.

In `test/submission-plan.test.js` replace `no relay: everyone allowed with real email, masked=false` with:

```js
test('relay.required false: everyone allowed with real email, masked=false', async () => {
  const plan = await buildSubmissionPlan({ config: { relay: { required: false } }, persons: [A, B], state: {} });
  assert.deepEqual(plan.allowed.map(x => [x.email, x.masked]), [['jane@example.com', false], ['john@example.com', false]]);
  assert.equal(plan.blocked.length, 0);
});

test('no relay block: everyone blocked, nobody gets the real email', async () => {
  const plan = await buildSubmissionPlan({ config: {}, persons: [A, B], state: {} });
  assert.equal(plan.allowed.length, 0);
  assert.equal(plan.blocked.length, 2);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/relay.test.js test/submission-plan.test.js`
Expected: FAIL on the new "blocks" tests and the `relayRequired({})` assert.

- [ ] **Step 3: Implement**

In `lib/relay.js` replace `relayRequired`:

```js
// Fail closed by default (fork rule): only an explicit required: false lets a
// person without an alias submit under their real email.
function relayRequired(config) {
  return !(config && config.relay && config.relay.required === false);
}
```

In `getSubmissionEmail` replace the two throws inside `if (relayRequired(config)) { ... }` with:

```js
      if (relayKeyIsPlaceholder(config)) {
        throw new RelayUnavailableError('relay.apiKey is still the placeholder. Paste your SimpleLogin API key into config.json, or set relay.required to false to send your real email instead');
      }
      throw new RelayUnavailableError('no usable relay is configured (provider "simplelogin" + apiKey). Add your SimpleLogin key to config.json, or set relay.required to false to send your real email instead');
```

Update the JSDoc above `getSubmissionEmail`: the first bullet becomes `- No usable relay -> RelayUnavailableError, unless relay.required is false (then person.email).` Update the file header sentence `When no relay is configured it returns person.email unchanged (fully backward compatible).` to `With no usable relay it throws RelayUnavailableError unless relay.required is false.`

In `watcher.js`, in the per-person loop, replace

```js
    else console.log('   Warning: No relay configured: brokers will receive your real email.');
```

with

```js
    else console.log('   Warning: relay.required is false: brokers will receive your real email.');
```

- [ ] **Step 4: Update the docs**

In `docs/UPEC-MANUAL.md` replace the troubleshooting row that starts with ``| `config.relay.required is true but no usable relay is configured`` with:

```
| `no usable relay is configured (provider "simplelogin" + apiKey) ...` | Add your SimpleLogin key as `apiKey` in the `relay` block. Without it nothing is submitted for you. Only `"required": false` sends your real email instead. |
```

In `docs/relay.md` step 4, replace the sentence `With "required": true and no usable relay configured (or the placeholder key still in place), every person is blocked and the run exits non-zero with no submissions.` with `With no usable relay configured (or the placeholder key still in place), every person is blocked and the run exits non-zero with no submissions. This is the default; only "required": false sends your real email instead.` (keep the backticks around `"required": false` as the file does for JSON).

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS, 0 fail. If a test outside these two files fails because it built a config with no `relay` block and expected the real email, add `relay: { required: false }` to that test's config and note the file in the commit message.

- [ ] **Step 6: Commit**

```bash
git add lib/relay.js watcher.js test/relay.test.js test/submission-plan.test.js docs/UPEC-MANUAL.md docs/relay.md
git commit -m "fix(relay): fail closed when the relay block or required key is missing

relayRequired was true only for required === true, so a config with no
relay block sent the real email. Now only an explicit required: false
does.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Node egress check expires and can be forced (P3, part 1)

**Files:**
- Modify: `lib/egress.js` (Node-side gate section)
- Modify: `watcher.js` (egress import line; the `ensureEgress:` line in the `--email` block)
- Test: `test/node-egress.test.js`, create `test/watcher-egress-wiring.test.js`

**Interfaces:**
- Produces: `ensureNodeEgress(config?, { fetchJson?, fresh? }) -> Promise<{ ok: true, mode }>`; `setEgressConfig(config, { fetchJson?, now? })`; exported `NODE_EGRESS_TTL_MS = 300000`.

- [ ] **Step 1: Write the failing tests**

Append to `test/node-egress.test.js`:

```js
test('a passed check is re-run once the TTL has passed', async () => {
  egress._resetNodeEgress();
  let t = 1000;
  let calls = 0;
  egress.setEgressConfig({}, { fetchJson: async () => { calls++; return { mullvad_exit_ip: true }; }, now: () => t });
  await egress.ensureNodeEgress();
  t += egress.NODE_EGRESS_TTL_MS - 1;
  await egress.ensureNodeEgress();
  assert.equal(calls, 1);
  t += 1;
  await egress.ensureNodeEgress();
  assert.equal(calls, 2);
});

test('a VPN that drops after the TTL is caught', async () => {
  egress._resetNodeEgress();
  let t = 0;
  let on = true;
  egress.setEgressConfig({}, { fetchJson: async () => ({ mullvad_exit_ip: on }), now: () => t });
  await egress.ensureNodeEgress();
  on = false;
  t += egress.NODE_EGRESS_TTL_MS;
  await assert.rejects(() => egress.ensureNodeEgress(), EgressError);
});

test('fresh: true checks now even inside the TTL', async () => {
  egress._resetNodeEgress();
  let calls = 0;
  egress.setEgressConfig({}, { fetchJson: async () => { calls++; return { mullvad_exit_ip: true }; } });
  await egress.ensureNodeEgress();
  await egress.ensureNodeEgress(undefined, { fresh: true });
  assert.equal(calls, 2);
});

test('the proxy note is printed once even when the check re-runs', async () => {
  egress._resetNodeEgress();
  const lines = await captureLog(async () => {
    await egress.ensureNodeEgress({ network: { proxy: 'socks5://127.0.0.1:1080' } });
    await egress.ensureNodeEgress({ network: { proxy: 'socks5://127.0.0.1:1080' } }, { fresh: true });
  });
  assert.equal(lines.filter(l => l === PROXY_NOTE).length, 1);
});
```

Create `test/watcher-egress-wiring.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');

test('the email step forces a fresh egress check instead of resetting the gate', () => {
  assert.match(src, /ensureNodeEgress\(cfg, \{ fresh: true \}\)/);
  assert.ok(!/_resetNodeEgress/.test(src), 'watcher must not wipe the gate config mid-run');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/node-egress.test.js test/watcher-egress-wiring.test.js`
Expected: FAIL (`NODE_EGRESS_TTL_MS` undefined, `calls` stays 1, watcher still uses `_resetNodeEgress`).

- [ ] **Step 3: Implement in `lib/egress.js`**

Replace everything from `let nodeGate = ...` through the end of `ensureNodeEgress` (keep `defaultNodeFetchJson` where it is) with:

```js
// A passed check is trusted for this long, then run again: a forms run lasts
// hours, and a VPN that drops mid-run must not let later Node-direct calls
// (CapSolver, SimpleLogin) leave from the real IP. A failure stays cached.
const NODE_EGRESS_TTL_MS = 5 * 60 * 1000;

function freshGate() {
  return { config: undefined, fetchJson: null, now: null, result: null, okAt: 0, notedProxy: false };
}

let nodeGate = freshGate();
```

(`defaultNodeFetchJson` stays here, unchanged.)

```js
/**
 * Record the config (and optionally an injected fetchJson and clock) the gate
 * uses when a call site has no config of its own (CapSolver, SMTP helpers,
 * registries). watcher.js calls it once after loading the config.
 */
function setEgressConfig(config, opts) {
  nodeGate.config = config;
  if (opts && typeof opts.fetchJson === 'function') nodeGate.fetchJson = opts.fetchJson;
  if (opts && typeof opts.now === 'function') nodeGate.now = opts.now;
}

function _resetNodeEgress() {
  nodeGate = freshGate();
}

/**
 * Fail-closed gate for Node-direct connections. A pass is cached for
 * NODE_EGRESS_TTL_MS, a failure for the rest of the process.
 * - network.required false: ok, nothing checked.
 * - network.proxy set: the proxy covers the browser only; print that once, ok.
 * - otherwise GET am.i.mullvad.net/json (15 s timeout) must report
 *   mullvad_exit_ip true, else throw EgressError.
 *
 * @param {object} [config]  defaults to the config given to setEgressConfig
 * @param {{ fetchJson?: (url: string) => Promise<object>, fresh?: boolean }} [opts]
 *   fresh: ignore a cached result and check now (the email steps, before every send)
 * @returns {Promise<{ ok: true, mode: string }>}
 */
function ensureNodeEgress(config, opts) {
  const clock = nodeGate.now || Date.now;
  const fresh = !!(opts && opts.fresh);
  const expired = nodeGate.okAt > 0 && clock() - nodeGate.okAt >= NODE_EGRESS_TTL_MS;
  if (nodeGate.result && !fresh && !expired) return nodeGate.result;
  nodeGate.okAt = 0;
  const cfg = config || nodeGate.config || {};
  const injected = (opts && typeof opts.fetchJson === 'function') ? opts.fetchJson : nodeGate.fetchJson;
  const fetchJson = injected || defaultNodeFetchJson;
  const gate = nodeGate;
  const p = (async () => {
    if (!egressRequired(cfg)) return { ok: true, mode: 'skipped' };
    let proxy = null;
    try { proxy = proxyFromConfig(cfg); } catch (_) { proxy = null; }
    if (proxy) {
      if (!gate.notedProxy) { gate.notedProxy = true; console.log(NODE_PROXY_NOTE); }
      return { ok: true, mode: 'proxy' };
    }
    let j = null;
    try { j = await fetchJson(MULLVAD_CHECK_URL); } catch (_) { j = null; }
    if (j && j.mullvad_exit_ip === true) return { ok: true, mode: 'mullvad' };
    throw new EgressError(NODE_EGRESS_FAIL);
  })();
  nodeGate.result = p;
  // Stamp the pass; a rejection is left cached. Also keeps an unawaited
  // failure from raising an unhandled-rejection warning.
  p.then(() => { if (gate.result === p) gate.okAt = clock(); }, () => {});
  return p;
}
```

Add `NODE_EGRESS_TTL_MS` to `module.exports`. Update the header comment line `ensureNodeEgress() is the matching gate...` paragraph by adding: `A pass is re-checked after NODE_EGRESS_TTL_MS.`

- [ ] **Step 4: Wire watcher**

In `watcher.js` change the import to

```js
const { setEgressConfig, ensureNodeEgress } = require('./lib/egress');
```

and in the `--email` block replace

```js
        ensureEgress: async (cfg) => { _resetNodeEgress(); return ensureNodeEgress(cfg); }, sleep: (ms) => new Promise(r => setTimeout(r, ms)),
```

with

```js
        ensureEgress: (cfg) => ensureNodeEgress(cfg, { fresh: true }),
        sleep: (ms) => new Promise(r => setTimeout(r, ms)),
```

- [ ] **Step 5: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/node-egress.test.js test/watcher-egress-wiring.test.js test/egress.test.js`
Expected: PASS. Then `npm test`: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/egress.js watcher.js test/node-egress.test.js test/watcher-egress-wiring.test.js
git commit -m "fix(egress): re-check the Node egress gate after 5 minutes

A pass used to be cached for the whole process, so CapSolver and
SimpleLogin calls hours into a run trusted a check from the start.
fresh: true replaces the reset the email step used before each send.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The browser egress is re-checked every 10 brokers (P3, part 2)

**Files:**
- Modify: `lib/browser-session.js` (`openBrowserSession`)
- Modify: `generic-runner.js` (`runGenericBrokers` loop)
- Modify: `watcher.js` (explicit-broker loop, generic pass call)
- Test: `test/browser-session.test.js`, create `test/generic-runner-egress.test.js`, `test/watcher-egress-wiring.test.js`

**Interfaces:**
- Consumes: `checkEgress`, `fetchJsonViaPage`, `EgressError` from `lib/egress.js`.
- Produces: `openBrowserSession(...) -> { context, close, recheckEgress: () => Promise<void> }` (throws `EgressError` when the check fails; no-op when `needsNetwork` is false). `runGenericBrokers(..., opts)` accepts `opts.recheckEgress` and rethrows `EgressError`. Constant `EGRESS_RECHECK_EVERY = 10` in both `watcher.js` and `generic-runner.js`.

- [ ] **Step 1: Write the failing tests**

Append to `test/browser-session.test.js`:

```js
test('recheckEgress passes while on the VPN and throws EgressError once it drops', async () => {
  const json = { mullvad_exit_ip: true, country: 'X' };
  const s = await openBrowserSession({ chromium: fakeChromium(json), config: {}, headless: true });
  await s.recheckEgress();
  json.mullvad_exit_ip = false;
  await assert.rejects(() => s.recheckEgress(), EgressError);
  await s.close();
});

test('recheckEgress is a no-op for a session that needs no network', async () => {
  const s = await openBrowserSession({ chromium: fakeChromium({ mullvad_exit_ip: false }), config: {}, headless: true, needsNetwork: false });
  await s.recheckEgress();
  await s.close();
});
```

Create `test/generic-runner-egress.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runGenericBrokers } = require('../generic-runner');
const { EgressError } = require('../lib/egress');

test('the generic pass re-checks egress every 10 brokers and stops when it fails', async () => {
  const brokers = Array.from({ length: 25 }, (_, i) => ({ name: `B${i}`, url: `https://b${i}.example/` }));
  let checks = 0;
  const seen = [];
  const context = { newPage: async () => ({ close: async () => {}, waitForTimeout: async () => {} }) };
  await assert.rejects(
    () => runGenericBrokers(context, new Set(), { optOuts: {} }, () => {}, () => {}, {
      injectedBrokers: brokers,
      injectedProcessFn: async (_page, b) => { seen.push(b.name); return { status: 'manual', detail: '' }; },
      recheckEgress: async () => { checks++; if (checks === 2) throw new EgressError('dropped'); },
    }),
    EgressError
  );
  assert.equal(checks, 2);
  assert.equal(seen.length, 20);
});

test('an EgressError from one broker stops the pass instead of being logged as an error', async () => {
  const context = { newPage: async () => ({ close: async () => {}, waitForTimeout: async () => {} }) };
  await assert.rejects(
    () => runGenericBrokers(context, new Set(), { optOuts: {} }, () => {}, () => {}, {
      injectedBrokers: [{ name: 'A', url: 'https://a.example/' }],
      injectedProcessFn: async () => { throw new EgressError('dropped'); },
    }),
    EgressError
  );
});
```

Append to `test/watcher-egress-wiring.test.js`:

```js
test('both broker loops re-check the browser egress', () => {
  assert.match(src, /await session\.recheckEgress\(\)/);
  assert.match(src, /recheckEgress: session\.recheckEgress/);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/browser-session.test.js test/generic-runner-egress.test.js test/watcher-egress-wiring.test.js`
Expected: FAIL (`s.recheckEgress is not a function`, no `EgressError` rejection, watcher has no `recheckEgress`).

- [ ] **Step 3: Implement in `lib/browser-session.js`**

Replace the body of `openBrowserSession` from `if (needsNetwork) {` to the final `return` with:

```js
  const runCheck = () => checkEgress({
    config,
    fetchJsonInBrowser: (url) => fetchJsonViaPage(context, url),
    fetchJsonDirect: fetchJsonDirect || defaultFetchJsonDirect,
  });

  if (needsNetwork) {
    const r = await runCheck();
    if (!r.ok) {
      await close();
      throw new EgressError(`Network check failed - nothing was submitted. ${r.detail}`);
    }
    console.log(`Network: ${r.detail}`);
  }

  // The same check again mid-run (the broker loops call it every few
  // brokers): a VPN that drops after launch must stop the run, not leak the rest.
  const recheckEgress = async () => {
    if (!needsNetwork) return;
    const r = await runCheck();
    if (!r.ok) throw new EgressError(`Network check failed mid-run - nothing more was submitted. ${r.detail}`);
  };
  return { context, close, recheckEgress };
```

- [ ] **Step 4: Implement in `generic-runner.js`**

Add to the requires: `const { EgressError } = require('./lib/egress');` and, next to `RECYCLE_EVERY`, `const EGRESS_RECHECK_EVERY = 10; // brokers between browser egress re-checks`. Replace the inner `try { result = await processFn(...); } catch (err) {` with:

```js
      try {
        if (opts.recheckEgress && stats.attempted > 0 && stats.attempted % EGRESS_RECHECK_EVERY === 0) {
          await opts.recheckEgress();
        }
        result = await processFn(page, broker, state, dryRun, opts.injectedDeadSet, { person, stateKey: keyFor(broker.name) });
      } catch (err) {
        // Off the VPN: stop the pass (finally still closes the page).
        if (err instanceof EgressError) throw err;
```

(the rest of the existing catch body stays).

- [ ] **Step 5: Wire watcher**

Next to `const LOCK_PATH = STATE_PATH + '.lock';` add:

```js
// Brokers between browser egress re-checks (about 2-3 minutes with jitter).
const EGRESS_RECHECK_EVERY = 10;
```

In the explicit-broker loop replace

```js
    console.log('\n── Explicit broker opt-outs ───────────────────────────────');
    for (const broker of sorted) {
      if (!brokerRunner.appliesToPerson(broker, person)) continue;
      process.stdout.write(`\n[${stamp()}] ${broker.name}… `);
      try {
        await brokerRunner.processBroker(context, broker);
```

with

```js
    console.log('\n── Explicit broker opt-outs ───────────────────────────────');
    let sinceCheck = 0;
    for (const broker of sorted) {
      if (!brokerRunner.appliesToPerson(broker, person)) continue;
      process.stdout.write(`\n[${stamp()}] ${broker.name}… `);
      try {
        if (++sinceCheck % EGRESS_RECHECK_EVERY === 0) await session.recheckEgress();
        await brokerRunner.processBroker(context, broker);
```

In the generic pass call add `recheckEgress: session.recheckEgress,` to the options object after `personCount: persons.length,`.

- [ ] **Step 6: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/browser-session.test.js test/generic-runner-egress.test.js test/watcher-egress-wiring.test.js`
Expected: PASS. Then `npm test`: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/browser-session.js generic-runner.js watcher.js test/browser-session.test.js test/generic-runner-egress.test.js test/watcher-egress-wiring.test.js
git commit -m "fix(egress): re-check the browser egress every 10 brokers

The browser was checked once at launch, so a VPN drop in an hours-long
run sent every later broker the real IP. Both loops now re-check and
stop with an EgressError.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Resends count toward the per-run cap (P6)

**Files:**
- Modify: `lib/email-step.js` (`runEmailStep`, the unknown-entries block)
- Test: `test/email-run-step.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/email-run-step.test.js`:

```js
test('resends count toward maxPerRun and go first', async () => {
  const state = { optOuts: {}, emailSent: { Alpha: { to: 'p@alpha.com', at: 't', status: 'unknown' } } };
  const two = [...targets, { name: 'Beta', domain: 'beta.com', to: 'p@beta.com', basis: null }];
  const cfg = { email: { ...config.email, maxPerRun: 1 } };
  const { d, out } = deps({ config: cfg, state, targets: two, ask: async q => (/Resend/.test(q) ? 'y' : 'SEND') });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 1);
  assert.equal(out.sent[0].to, 'p@alpha.com');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --require ./test/helpers/egress-off.js --test test/email-run-step.test.js`
Expected: FAIL (`out.sent.length` is 2).

- [ ] **Step 3: Implement**

In `runEmailStep` replace the block from `// Interrupted sends from an earlier run: ask, never guess.` through `if (!plan.items.length) { log('No email requests pending.'); return 0; }` with:

```js
  // Interrupted sends from an earlier run: ask, never guess.
  const resend = [];
  if (!preview) {
    for (const u of plan.unknown) {
      const a = String(await ask(`  ${u.name} (${u.to}) may or may not have been sent last time. Resend? [y/N] `)).trim().toLowerCase();
      if (a === 'y' || a === 'yes') resend.push(u);
      else markUnknownAsSent(state, u);
    }
    if (plan.unknown.length) save();
  }
  // Resends count toward the cap like any other send, and go first.
  plan.items = [...resend, ...plan.items].slice(0, maxPerRun);

  if (!plan.items.length) { log('No email requests pending.'); return 0; }
```

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/email-run-step.test.js test/email-step.test.js test/email-step-review-fixes.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email-step.js test/email-run-step.test.js
git commit -m "fix(email): resends count toward maxPerRun

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Right-to-know goes through the email step (P2)

`--know` had its own sender with no SEND prompt, no terminal check, no pacing, no cap, no record-before-send and no `network.proxy` refusal. It now builds items and hands them to the same tail the `--email` step uses.

**Files:**
- Modify: `lib/email-step.js` (extract `confirmAndSend`; `sendEmailPlan` gets `afterSend`)
- Rewrite: `lib/right-to-know-runner.js`
- Modify: `watcher.js` (add `askLine` and `emailStepIo`; `--email` block; `--know` block)
- Delete: `test/right-to-know-runner.test.js`, `test/right-to-know-relay.test.js`
- Modify: `test/node-egress.test.js` (remove the right-to-know test and `stubNodemailer`)
- Create: `test/right-to-know-step.test.js`, `test/watcher-know-step.test.js`
- Docs: `docs/UPEC-MANUAL.md` (`know` row in the command reference)

**Interfaces:**
- Consumes: `checkEmailSetup`, `sendEmailPlan` (`lib/email-step.js`); `buildKnowRequest({ person, broker })` (`lib/right-to-know.js`); `stateKey`, `recordKnowRequest(brokerName, person, totalPersons)` (`lib/config.js`); `submissionOptions(plan) -> { submissionEmailFor, blockedPersons }` (`lib/submission-plan.js`); `ensureNodeEgress(cfg, { fresh: true })` (Task 3).
- Produces:
  - `confirmAndSend(items, { config, state, save, preview, ask, log, makeTransport, ensureEgress, sleep, label?, rerun?, onSent? }) -> Promise<0|1>`; items are non-empty `{ key, name, to, basis, subject, body }`.
  - `sendEmailPlan(items, { ..., afterSend? })`: `afterSend(item)` runs after a successful send is recorded and saved.
  - `runKnowStep({ config, persons, state, save, brokers, preview, isTTY, ask, log, makeTransport, ensureEgress, sleep, submissionEmailFor, blockedPersons, recordKnow? }) -> Promise<0|1>`
  - `buildKnowPlan({ brokers, persons, state, submissionEmailFor, blockedPersons, maxPerRun }) -> item[]`
  - `KNOW_PREFIX = 'know:'`
  - In `watcher.js`: `askLine(question) -> Promise<string>` and `emailStepIo() -> { isTTY, ask, log, makeTransport, ensureEgress, sleep }`.

- [ ] **Step 1: Write the failing tests**

Create `test/right-to-know-step.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runKnowStep, buildKnowPlan, KNOW_PREFIX } = require('../lib/right-to-know-runner');

const P = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Austin', state: 'TX', zip: '73301', country: 'US', email: 'jane.doe@example.com', phoneFormatted: '(555) 555-0100' };
const ALIAS = 'jane.masked@aliases.simplelogin.io';
const FROM = 'requests.only@example.net';
const config = { email: { smtp: { host: 'h', port: 587, user: FROM, pass: 'pw', from: FROM }, paceSeconds: 1, maxPerRun: 100 } };
const BROKERS = [{ name: 'Pipl', method: 'email', emailTo: 'Privacy@Pipl.com' }, { name: 'WebOnly', method: 'search-form' }];

function deps(over = {}) {
  const out = { lines: [], sent: [], egress: 0, transports: 0, recorded: [] };
  const d = {
    config, persons: [P], state: { optOuts: {} }, save: () => {}, brokers: BROKERS,
    preview: false, isTTY: true, ask: async () => 'SEND', log: l => out.lines.push(l),
    makeTransport: () => { out.transports++; return { sendMail: async m => { out.sent.push(m); return { messageId: 'x' }; } }; },
    ensureEgress: async () => { out.egress++; }, sleep: async () => {},
    submissionEmailFor: () => ALIAS, blockedPersons: new Set(),
    recordKnow: (name) => out.recorded.push(name),
    ...over,
  };
  return { d, out };
}

test('SEND sends one request per email broker, behind the egress gate, with the alias only', async () => {
  const { d, out } = deps();
  assert.equal(await runKnowStep(d), 0);
  assert.equal(out.sent.length, 1);
  assert.equal(out.sent[0].to, 'privacy@pipl.com');
  assert.equal(out.sent[0].from, FROM);
  assert.ok(out.sent[0].text.includes(ALIAS));
  assert.ok(!out.sent[0].text.includes(P.email));
  assert.equal(out.egress, 2);
  assert.deepEqual(out.recorded, ['Pipl']);
  assert.ok(d.state.emailSent[`${KNOW_PREFIX}Pipl`].messageId);
});

test('anything but SEND sends nothing', async () => {
  const { d, out } = deps({ ask: async () => 'send' });
  assert.equal(await runKnowStep(d), 1);
  assert.equal(out.sent.length, 0);
  assert.equal(out.transports, 0);
});

test('no interactive terminal: refused before anything', async () => {
  const { d, out } = deps({ isTTY: false });
  assert.equal(await runKnowStep(d), 1);
  assert.match(out.lines.join('\n'), /interactive terminal/);
  assert.equal(out.transports, 0);
});

test('network.proxy is refused: SMTP would leave from the real IP', async () => {
  const { d, out } = deps({ config: { ...config, network: { proxy: 'socks5://127.0.0.1:1080' } } });
  assert.equal(await runKnowStep(d), 1);
  assert.match(out.lines.join('\n'), /network\.proxy/);
  assert.equal(out.transports, 0);
});

test('no email block: refused with the setup message', async () => {
  const { d, out } = deps({ config: {} });
  assert.equal(await runKnowStep(d), 1);
  assert.match(out.lines.join('\n'), /email\.smtp block/);
});

test('preview prints the body and opens no transport', async () => {
  const { d, out } = deps({ preview: true, isTTY: false, ask: async () => { throw new Error('no prompt in preview'); } });
  assert.equal(await runKnowStep(d), 0);
  assert.equal(out.transports, 0);
  assert.equal(out.egress, 0);
  assert.ok(out.lines.join('\n').includes(ALIAS));
});

test('a request already sent is never sent again', async () => {
  const state = { optOuts: {}, emailSent: { [`${KNOW_PREFIX}Pipl`]: { to: 'privacy@pipl.com', at: 't', messageId: 'm' } } };
  const { d, out } = deps({ state });
  assert.equal(await runKnowStep(d), 0);
  assert.equal(out.sent.length, 0);
  assert.match(out.lines.join('\n'), /No right-to-know requests pending/);
});

test('an opt-out email to the same broker does not count as a know request', () => {
  const state = { emailSent: { Pipl: { to: 'privacy@pipl.com', at: 't', messageId: 'm' } } };
  const items = buildKnowPlan({ brokers: BROKERS, persons: [P], state, submissionEmailFor: () => ALIAS, blockedPersons: new Set(), maxPerRun: 100 });
  assert.equal(items.length, 1);
});

test('a blocked person, or one with no address, gets nothing (never the real email)', () => {
  const base = { brokers: BROKERS, persons: [P], state: {}, maxPerRun: 100 };
  assert.deepEqual(buildKnowPlan({ ...base, submissionEmailFor: () => undefined, blockedPersons: new Set() }), []);
  assert.deepEqual(buildKnowPlan({ ...base, submissionEmailFor: () => ALIAS, blockedPersons: new Set([P]) }), []);
});

test('the per-run cap applies', () => {
  const brokers = [...BROKERS, { name: 'Other', method: 'email', emailTo: 'privacy@other.example' }];
  const items = buildKnowPlan({ brokers, persons: [P], state: {}, submissionEmailFor: () => ALIAS, blockedPersons: new Set(), maxPerRun: 1 });
  assert.equal(items.length, 1);
});
```

Create `test/watcher-know-step.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');

test('--know goes through runKnowStep with the shared email-step wiring', () => {
  assert.match(src, /runKnowStep\(/);
  assert.ok(!/sendKnowRequests/.test(src), 'the old separate sender must be gone');
  assert.equal((src.match(/\.\.\.emailStepIo\(\)/g) || []).length, 2, '--email and --know share one wiring');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/right-to-know-step.test.js test/watcher-know-step.test.js`
Expected: FAIL (`runKnowStep` is not a function; watcher still calls `sendKnowRequests`).

- [ ] **Step 3: Extract `confirmAndSend` in `lib/email-step.js`**

In `sendEmailPlan`, add `afterSend = () => {}` to the destructured options (after `beforeSend = async () => {}`), and right after the success `save();` (the one following `state.emailSent[it.key] = { to: it.to, at: now(), messageId: ... };`) add `afterSend(it);`.

Add above `runEmailStep`:

```js
/**
 * The shared tail of the --email and --know steps: list the items, print the
 * letter, then either stop (preview) or ask for SEND, pass the egress gate and
 * send at the configured pace. `items` must not be empty. Returns the exit code.
 */
async function confirmAndSend(items, { config, state, save, preview, ask, log, makeTransport, ensureEgress, sleep, label = 'email request(s)', rerun = '--email', onSent }) {
  const emailCfg = config.email;
  const from = emailCfg.smtp.from;
  const paceMs = Math.max(1, Number(emailCfg.paceSeconds) || 45) * 1000;

  log(`${items.length} ${label} from ${from}:`);
  for (const it of items) {
    log(`  ${it.name.padEnd(40)} ${it.to}`);
    if (it.basis) log(`      basis (${it.basis.kind}): "${it.basis.quote}"  ${it.basis.url}`);
  }
  log(`\nSubject: ${items[0].subject}\n\n${items[0].body}\n`);
  if (preview) {
    for (const it of items.slice(1)) log(`--- ${it.name} ---\n${it.body}\n`);
    log('Preview: nothing sent.');
    return 0;
  }

  const minutes = Math.ceil(((items.length - 1) * paceMs) / 60000);
  const answer = String(await ask(`Type SEND to send ${items.length} email(s), one every ${paceMs / 1000}s (about ${minutes} min): `)).trim();
  if (answer !== 'SEND') { log('Not sent.'); return 1; }

  await ensureEgress(config);
  const result = await sendEmailPlan(items, { transport: makeTransport(emailCfg.smtp), from, paceMs, sleep, state, save, log, beforeSend: () => ensureEgress(config), afterSend: onSent });
  log(`\nEmail requests: ${result.sent.length} sent, ${result.failed.length} not delivered.`);
  if (result.stopped === 'auth') log('Stopped: the mailbox refused the login. Check email.smtp.user and the app password (2-step verification must be on).');
  if (result.stopped === 'connection') log(`Stopped: the mail server could not be reached. Check the connection and run ${rerun} again; nothing was counted against any broker.`);
  if (result.stopped === 'egress') log(`Stopped: Mullvad is not connected. Reconnect and run ${rerun} again; it carries on where it stopped.`);
  if (result.stopped === 'quota') log(`Stopped: the mailbox hit its sending limit. Run ${rerun} again tomorrow; it carries on where it stopped.`);
  return result.stopped ? 1 : 0;
}
```

Then in `runEmailStep`: change the signature to take `deps` and destructure (`async function runEmailStep(deps) { const { config, persons, state, save, targets, brokers, preview, isTTY, ask, log } = deps;`), remove the now-unused `paceMs` line, and replace everything after `if (!plan.items.length) { log('No email requests pending.'); return 0; }` with:

```js
  return confirmAndSend(plan.items, deps);
}
```

Add `confirmAndSend` to `module.exports`.

- [ ] **Step 4: Rewrite `lib/right-to-know-runner.js`**

```js
'use strict';
/**
 * lib/right-to-know-runner.js
 *
 * Right-to-know (data access) requests by email. They use the same checks and
 * sender as the --email step (lib/email-step.js): the dedicated mailbox, no
 * network.proxy, an interactive SEND, the egress re-check before every send,
 * pacing, the per-run cap, and a record before and after each send, so a
 * broker never gets the same request twice for the same person.
 *
 * Keys are "know:" + stateKey in state.emailSent, apart from opt-out emails.
 */
const { stateKey, recordKnowRequest } = require('./config');
const { buildKnowRequest } = require('./right-to-know');
const { checkEmailSetup, confirmAndSend } = require('./email-step');

const KNOW_PREFIX = 'know:';

function buildKnowPlan({ brokers, persons, state, submissionEmailFor, blockedPersons, maxPerRun }) {
  const sent = (state && state.emailSent) || {};
  const items = [];
  for (const broker of (brokers || []).filter(b => b.method === 'email' && b.emailTo)) {
    for (const person of persons || []) {
      if (blockedPersons && blockedPersons.has(person)) continue;
      // No resolved address: fail closed, never the real email.
      const address = submissionEmailFor(person);
      if (!address) continue;
      const key = KNOW_PREFIX + stateKey(broker.name, person, persons.length);
      if (sent[key]) continue;
      const { subject, body } = buildKnowRequest({ person: { ...person, email: address }, broker });
      items.push({ key, name: broker.name, to: String(broker.emailTo).trim().toLowerCase(), basis: null, subject, body, person });
    }
  }
  return items.slice(0, maxPerRun);
}

async function runKnowStep(deps) {
  const { config, persons, isTTY, preview, log } = deps;
  log('\n-- Right-to-know requests ----------------------------------');
  const problem = checkEmailSetup({ config, persons, isTTY, preview });
  if (problem) { log(`Right-to-know not sent: ${problem}.`); return 1; }
  const maxPerRun = Math.max(1, Number(config.email.maxPerRun) || 100);
  const items = buildKnowPlan({ ...deps, maxPerRun });
  if (!items.length) { log('No right-to-know requests pending.'); return 0; }
  const recordKnow = deps.recordKnow || recordKnowRequest;
  return confirmAndSend(items, {
    ...deps,
    label: 'right-to-know request(s)',
    rerun: '--know',
    // --know-status reads knowRequestedAt to flag requests past 45 days.
    onSent: (it) => recordKnow(it.name, it.person, persons.length),
  });
}

module.exports = { runKnowStep, buildKnowPlan, KNOW_PREFIX };
```

- [ ] **Step 5: Wire watcher**

Directly after `require('./lib/privilege').exitIfRoot();` add:

```js
// One line of input from the terminal.
function askLine(question) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, a => { rl.close(); resolve(a); });
  });
}

// Terminal, transport and gate wiring shared by the --email and --know steps.
function emailStepIo() {
  const nodemailer = require('nodemailer');
  const { smtpTransportOptions } = require('./lib/email');
  return {
    isTTY: !!process.stdin.isTTY,
    ask: askLine,
    log: (l) => console.log(l),
    makeTransport: (smtp) => nodemailer.createTransport(smtpTransportOptions(smtp)),
    ensureEgress: (cfg) => ensureNodeEgress(cfg, { fresh: true }),
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  };
}
```

In the `--email` block of `_mainBody`, delete the `nodemailer`, `smtpTransportOptions` and `askLine` local declarations and replace the `runEmailStep({...})` argument with:

```js
      code = await runEmailStep({
        config, persons, state, save: saveState,
        targets: catalogEmailTargets(catalogRecords, { explicitNames: explicitCatalogOpts.explicitNames }),
        brokers, preview: DRY_RUN, ...emailStepIo(),
      });
```

Replace the whole `if (KNOW_MODE) { ... }` block body (from `const brokers = require('./brokers');` to the closing `});` of its `.catch`) with:

```js
  const brokers = require('./brokers');
  const { runKnowStep } = require('./lib/right-to-know-runner');
  const { getPendingKnowRequests } = require('./lib/config');
  const KNOW_LOCK_PATH = STATE_PATH + '.lock';
  try {
    lock.acquire(KNOW_LOCK_PATH);
  } catch (err) {
    const pidMatch = err.message.match(/pid (\d+)/);
    console.error(`Another instance is running, pid=${pidMatch ? pidMatch[1] : '?'}. Exiting.`);
    process.exit(1);
  }

  (async () => {
    const plan = await buildSubmissionPlan({ config, persons, state, preview: DRY_RUN });
    for (const b of plan.blocked) {
      console.error(`Skipping person #${persons.indexOf(b.person) + 1}: ${b.reason}`);
    }
    if (plan.allowed.some(a => a.placeholder)) console.log(PREVIEW_ALIAS_NOTE);
    const code = await runKnowStep({
      config, persons, state, save: saveState, brokers, preview: DRY_RUN,
      ...submissionOptions(plan), ...emailStepIo(),
    });
    const pending = getPendingKnowRequests(brokers, { olderThanDays: 45 });
    console.log(`\n${pending.length} earlier request(s) are past 45 days (run --know-status for detail).\n`);
    return code;
  })().then((code) => {
    lock.release(KNOW_LOCK_PATH);
    process.exit(code);
  }).catch(err => {
    lock.release(KNOW_LOCK_PATH);
    console.error('know error:', err.message);
    process.exit(1);
  });
```

(Task 10 replaces the lock lines with a helper.)

- [ ] **Step 6: Remove the old sender's tests**

```bash
git rm test/right-to-know-runner.test.js test/right-to-know-relay.test.js
```

In `test/node-egress.test.js` delete the test `SMTP right-to-know: failing gate means sendMail is never called`, then run `grep -n "stubNodemailer" test/node-egress.test.js`; if only the definition is left, delete the `stubNodemailer` function too.

- [ ] **Step 7: Update the manual**

In `docs/UPEC-MANUAL.md` replace the command-reference row that starts with ``| `know` |`` with:

```
| `know` | Sends "what do you hold about me" requests under the California (CCPA) or European (GDPR) privacy law to the brokers that take requests by email. It needs the `email` block and works like `run --email`: same dedicated mailbox, you type SEND, Mullvad is re-checked before every email, one email every 45 s, and the same request is never sent twice. | SimpleLogin: a request for your alias if none exists yet. Your SMTP server and those brokers: your name, city, state, zip, phone and alias. |
```

- [ ] **Step 8: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/right-to-know-step.test.js test/watcher-know-step.test.js test/email-run-step.test.js test/email-step.test.js test/node-egress.test.js test/right-to-know.test.js test/right-to-know-config.test.js`
Expected: PASS. Then `npm test`: PASS. If `test/upec-docs.test.js` or `test/docs-commands.test.js` pins the old `know` row text, update the expectation to the new row.

- [ ] **Step 9: Commit**

```bash
git add -A lib/email-step.js lib/right-to-know-runner.js watcher.js docs/UPEC-MANUAL.md test/
git commit -m "fix(know): send right-to-know requests through the email step

--know had its own sender: no SEND prompt, no terminal check, no pacing,
no cap, no record before sending and no network.proxy refusal. It now
uses checkEmailSetup and the shared confirmAndSend tail, keyed know:...
so a request is never sent twice.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The breach check asks before sending the real email (P4)

**Files:**
- Modify: `lib/hibp.js` (add `confirmBreachCheck`)
- Modify: `watcher.js` (`--breach-check` block)
- Test: create `test/hibp-confirm.test.js`
- Docs: `docs/UPEC-MANUAL.md` (`breach` row)

**Interfaces:**
- Consumes: `askLine` (Task 6).
- Produces: `confirmBreachCheck({ emails, isTTY, ask, log }) -> Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Create `test/hibp-confirm.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { confirmBreachCheck } = require('../lib/hibp');

function io(answer, isTTY = true) {
  const lines = [];
  let asked = 0;
  return { lines, get asked() { return asked; }, args: { emails: ['jane.doe@example.com'], isTTY, ask: async () => { asked++; return answer; }, log: l => lines.push(l) } };
}

test('no interactive terminal: refused without asking', async () => {
  const x = io('YES', false);
  assert.equal(await confirmBreachCheck(x.args), false);
  assert.equal(x.asked, 0);
  assert.match(x.lines.join('\n'), /interactive terminal/);
});

test('only YES continues, after saying the real address goes to haveibeenpwned.com', async () => {
  const yes = io('YES');
  assert.equal(await confirmBreachCheck(yes.args), true);
  assert.match(yes.lines.join('\n'), /haveibeenpwned\.com/);
  for (const a of ['yes', 'y', '', 'SEND']) assert.equal(await confirmBreachCheck(io(a).args), false);
});

test('watcher asks before running the breach check', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');
  const i = src.indexOf('confirmBreachCheck(');
  assert.ok(i > 0);
  assert.ok(i < src.indexOf('await runBreachCheck('));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/hibp-confirm.test.js`
Expected: FAIL (`confirmBreachCheck` is not a function).

- [ ] **Step 3: Implement**

In `lib/hibp.js` add before `module.exports`, and add `confirmBreachCheck` to the exports:

```js
/**
 * --breach-check sends each address in full to haveibeenpwned.com, under an
 * API key tied to the member. That is the one command that sends the real
 * email by design, so it runs only after the member reads this and types YES.
 */
async function confirmBreachCheck({ emails, isTTY, ask, log }) {
  if (!isTTY) {
    log('breach-check needs an interactive terminal: it asks before sending your real email address to Have I Been Pwned.');
    return false;
  }
  log(`This sends ${emails.length} real email address(es) in full to haveibeenpwned.com, linked to your HIBP API key.`);
  const answer = String(await ask('Type YES to continue: ')).trim();
  if (answer !== 'YES') { log('Not sent.'); return false; }
  return true;
}
```

In `watcher.js`, in the `--breach-check` async block, insert before `console.log(\`\nChecking ${emails.length} email(s)...`:

```js
    const ok = await confirmBreachCheck({ emails, isTTY: !!process.stdin.isTTY, ask: askLine, log: (l) => console.log(l) });
    if (!ok) process.exit(1);
```

and add `confirmBreachCheck,` to the `require('./lib/hibp')` destructuring in that block.

- [ ] **Step 4: Update the manual**

In `docs/UPEC-MANUAL.md`, in the ``| `breach` |`` row, change the description cell to `Checks Have I Been Pwned for breaches. Needs hibp.apiKey and an interactive terminal; it asks you to type YES first.` (keep `hibp.apiKey` in backticks).

- [ ] **Step 5: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/hibp-confirm.test.js test/hibp.test.js`
Expected: PASS. Then `npm test`: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/hibp.js watcher.js test/hibp-confirm.test.js docs/UPEC-MANUAL.md
git commit -m "fix(breach): ask for YES before sending the real email to HIBP

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The generic pass never counts a cookie manager as an opt-out (P5)

`handlePrivacyManager` clicked `#accept-recommended-btn-handler` (OneTrust "Allow All") or any button with Save or Confirm text, and the run recorded a success with a 90-day cooldown. It also had no visibility check, so a hidden button cost the 30 s default click timeout. A cookie choice made in the throwaway profile is deleted with the profile, so this strategy is removed.

**Files:**
- Modify: `generic-runner.js` (delete `handlePrivacyManager` and Strategy 2; update the header comment)
- Test: `test/generic-runner-false-success.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/generic-runner-false-success.test.js`:

```js
test('a cookie preference center is never an opt-out: no Allow All or Save click, status manual', async () => {
  const clicked = [];
  const locator = (sel) => {
    const present = /accept-recommended-btn-handler|has-text\("Save"\)|has-text\("Confirm"\)|ot-tgl/.test(sel);
    const self = {
      first: () => self,
      all: async () => [],
      count: async () => (present ? 1 : 0),
      isVisible: async () => present,
      click: async () => { clicked.push(sel); },
      evaluate: async (fn) => fn({ tagName: 'INPUT', type: 'text' }),
      fill: async () => {},
      selectOption: async () => {},
      locator: () => self,
      allTextContents: async () => [],
      getAttribute: async () => null,
    };
    return self;
  };
  const page = { goto: async () => ({ status: () => 200 }), waitForTimeout: async () => {}, content: async () => '', url: () => BROKER.url, locator };
  _setConfig({ person: { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: 'jane.doe@example.com', state: 'TX', zip: '73301' } });
  try {
    const result = await processGenericUrl(page, BROKER, { optOuts: {} }, false, new Set(), {});
    assert.equal(result.status, 'manual');
    assert.ok(!clicked.some(s => /accept-recommended|Save|Confirm/.test(s)), `clicked: ${clicked.join(' | ')}`);
  } finally {
    _setConfig(null);
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-runner-false-success.test.js`
Expected: FAIL (status is not `manual`, or `clicked` contains the Allow All selector).

- [ ] **Step 3: Implement**

In `generic-runner.js`: delete the `// ─── OneTrust / TrustArc / Osano preference opt-out` section and the `handlePrivacyManager` function; delete the three lines

```js
    // Strategy 2: OneTrust / TrustArc privacy manager
    const managed = await handlePrivacyManager(page);
    if (managed) return finalize('Privacy manager opted out');
```

and renumber the following comments `Strategy 3` to `Strategy 2` and `Strategy 4` to `Strategy 3`. In the header comment replace items a-e with:

```
 *      a. "Do Not Sell My Personal Information" button → click it, then fill
 *         and submit any form it opens
 *      b. Form with email and/or name fields → fill + submit
 *      c. DSAR / data request link → manual list
 *   Cookie-consent managers are not used: a cookie choice made in the
 *   throwaway browser profile is deleted with the profile, so it is never an
 *   opt-out.
```

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-runner-*.test.js test/allowlist-generic-runner.test.js test/feeds-generic-runner.test.js`
Expected: PASS. Then `npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add generic-runner.js test/generic-runner-false-success.test.js
git commit -m "fix(generic): stop recording cookie-manager clicks as opt-outs

The privacy-manager strategy clicked OneTrust's Allow All or any Save
button and recorded a success with a 90-day cooldown.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: One locator per selector list in the generic pass

**Files:**
- Modify: `generic-runner.js` (`dismissBanners`, `clickDoNotSell`, exports)
- Create: `test/generic-selectors.browser.test.js` (runs only with `UPEC_WIPE_BROWSER_TESTS=1`), `test/generic-selectors.test.js`

**Interfaces:**
- Produces: exports `_dismissBanners(page)` and `_clickDoNotSell(page) -> Promise<boolean>` for tests.

- [ ] **Step 1: Write the failing tests**

Create `test/generic-selectors.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _dismissBanners, _clickDoNotSell } = require('../generic-runner');

function countingPage() {
  const seen = [];
  const self = { first: () => self, count: async () => 0, isVisible: async () => false, click: async () => {} };
  return { seen, locator: (sel) => { seen.push(sel); return self; }, waitForTimeout: async () => {} };
}

test('each selector list is one locator, filtered to visible elements', async () => {
  const p = countingPage();
  await _dismissBanners(p);
  assert.equal(p.seen.length, 1);
  assert.match(p.seen[0], /#onetrust-reject-all-handler.* >> visible=true$/);
  const q = countingPage();
  assert.equal(await _clickDoNotSell(q), false);
  assert.equal(q.seen.length, 1);
  assert.match(q.seen[0], /Do Not Sell.* >> visible=true$/);
});
```

Create `test/generic-selectors.browser.test.js`:

```js
'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = Boolean(process.env.UPEC_WIPE_BROWSER_TESTS);

describe('generic-runner combined locators (real browser)', { skip: !ENABLED }, () => {
  let browser;
  let page;
  before(async () => {
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  after(async () => { if (browser) await browser.close(); });

  test('Do Not Sell: a hidden match is skipped and the visible one is clicked', async () => {
    const { _clickDoNotSell } = require('../generic-runner');
    await page.setContent('<a href="#" style="display:none" onclick="window.hit=\'hidden\'">Do Not Sell</a><button onclick="window.hit=\'shown\'">Do Not Sell My Info</button>');
    assert.equal(await _clickDoNotSell(page), true);
    assert.equal(await page.evaluate(() => window.hit), 'shown');
  });

  test('cookie banner: the visible reject button is clicked', async () => {
    const { _dismissBanners } = require('../generic-runner');
    await page.setContent('<button id="onetrust-reject-all-handler" onclick="window.hit=1">Reject All</button>');
    await _dismissBanners(page);
    assert.equal(await page.evaluate(() => window.hit), 1);
  });

  test('nothing visible: no click, false', async () => {
    const { _clickDoNotSell } = require('../generic-runner');
    await page.setContent('<p>No links here</p>');
    assert.equal(await _clickDoNotSell(page), false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-selectors.test.js`
Expected: FAIL (`_dismissBanners` is not a function).

- [ ] **Step 3: Implement**

In `generic-runner.js` replace `dismissBanners` and `clickDoNotSell` (keep the two selector arrays) with:

```js
// One locator per list: a single browser round trip per page instead of a
// count() and isVisible() per selector, about 500 times per pass. The first
// visible match in document order wins.
const DECLINE_COOKIE_LOCATOR = `${DECLINE_COOKIE_SELECTORS.join(', ')} >> visible=true`;

async function dismissBanners(page) {
  try {
    const el = page.locator(DECLINE_COOKIE_LOCATOR).first();
    if ((await el.count()) > 0) {
      await el.click({ timeout: 1000 });
      await page.waitForTimeout(500);
    }
  } catch (_) {}
}
```

(place `DNS_LOCATOR` after `DNS_SELECTORS`)

```js
const DNS_LOCATOR = `${DNS_SELECTORS.join(', ')} >> visible=true`;

async function clickDoNotSell(page) {
  try {
    const el = page.locator(DNS_LOCATOR).first();
    if ((await el.count()) > 0) {
      await el.click({ timeout: 2000 });
      await page.waitForTimeout(1500);
      return true;
    }
  } catch (_) {}
  return false;
}
```

Add `_dismissBanners: dismissBanners, _clickDoNotSell: clickDoNotSell` to `module.exports`.

- [ ] **Step 4: Run the tests, including the real browser**

Run: `node --require ./test/helpers/egress-off.js --test test/generic-selectors.test.js test/generic-runner-*.test.js`
Expected: PASS.
Run: `UPEC_WIPE_BROWSER_TESTS=1 node --test test/generic-selectors.browser.test.js`
Expected: PASS, 3 tests. If Chromium is missing, run `npx playwright install chromium` first. If the `>> visible=true` form is rejected by this Playwright version, use `page.locator(list).filter({ visible: true }).first()` in both functions, and change the regexes in `test/generic-selectors.test.js` to drop ` >> visible=true$`.

- [ ] **Step 5: Commit**

```bash
git add generic-runner.js test/generic-selectors.test.js test/generic-selectors.browser.test.js
git commit -m "perf(generic): one locator per selector list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `--list` reads the catalog once; one state-lock helper; `reply` takes the lock

**Files:**
- Modify: `watcher.js`
- Test: create `test/watcher-state-lock.test.js`

**Interfaces:**
- Produces: `acquireStateLockOrExit() -> string` (the lock path) in `watcher.js`.

- [ ] **Step 1: Write the failing tests**

Create `test/watcher-state-lock.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');
const between = (a, b) => src.slice(src.indexOf(a), src.indexOf(b));

test('--list reads the catalog once (about 2.5 s per read on /mnt/c)', () => {
  const block = between('if (LIST_MODE) {', "if (process.argv.includes('--reply'))");
  assert.equal((block.match(/loadCatalog\(/g) || []).length, 1);
});

test('reply takes the state lock and reloads state under it', () => {
  const block = between("if (process.argv.includes('--reply'))", 'if (SCORE_MODE) {');
  assert.match(block, /acquireStateLockOrExit\(\)/);
  assert.match(block, /resetState\(\)/);
});

test('the lock-or-exit code exists once', () => {
  assert.equal((src.match(/Another instance is running/g) || []).length, 1);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/watcher-state-lock.test.js`
Expected: FAIL (2 `loadCatalog(` calls; no helper; 5 copies of the message).

- [ ] **Step 3: Implement**

Add next to `askLine` (top of `watcher.js`):

```js
// One process at a time writes state.json. Exits 1 naming the holder's pid.
function acquireStateLockOrExit() {
  const lockPath = STATE_PATH + '.lock';
  try {
    lock.acquire(lockPath);
  } catch (err) {
    const pidMatch = err.message.match(/pid (\d+)/);
    console.error(`Another instance is running, pid=${pidMatch ? pidMatch[1] : '?'}. Exiting.`);
    process.exit(1);
  }
  return lockPath;
}
```

(Like `askLine`, it sits after the `require('./lib/privilege').exitIfRoot();` line, below every `require`, so `STATE_PATH` and `lock` are already defined.)

Replace each of the five `try { lock.acquire(X); } catch (err) { ... Another instance is running ... process.exit(1); }` blocks:
- freeze: `if (isMutation) { try {...} }` becomes `if (isMutation) acquireStateLockOrExit();` (keep `FREEZE_LOCK_PATH` for the release).
- confirm-emails, report, know, main(): replace the try/catch with `acquireStateLockOrExit();` and keep the existing `*_LOCK_PATH` constants for the releases.

In `--list`, replace

```js
  const { loadCatalog, catalogSummary } = require('./lib/catalog');
  const catalog = catalogSummary(loadCatalog());
```

with

```js
  const { loadCatalog, catalogSummary, catalogEmailTargets } = require('./lib/catalog');
  const catalogRecords = loadCatalog();
  const catalog = catalogSummary(catalogRecords);
```

then delete the later `const { catalogEmailTargets } = require('./lib/catalog');` line and change `catalogEmailTargets(loadCatalog(), {` to `catalogEmailTargets(catalogRecords, {`.

In `--reply`, replace

```js
  const st = loadState();
  const keys = Object.keys(st.emailSent || {}).filter(k => k === found.name || k.startsWith(`${found.name}|`));
  for (const key of (keys.length ? keys : [found.name])) recordReply(st, key, outcome);
  saveState();
```

with

```js
  const replyLock = acquireStateLockOrExit();
  try {
    // Reload under the lock: a run may have written state since this process started.
    const st = require('./lib/config').resetState();
    const keys = Object.keys(st.emailSent || {}).filter(k => k === found.name || k.startsWith(`${found.name}|`));
    for (const key of (keys.length ? keys : [found.name])) recordReply(st, key, outcome);
    saveState();
  } finally {
    lock.release(replyLock);
  }
```

- [ ] **Step 4: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/watcher-state-lock.test.js test/email-reply.test.js test/freeze-cli.test.js test/lock.test.js`
Expected: PASS. Then `npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add watcher.js test/watcher-state-lock.test.js
git commit -m "refactor(watcher): one state-lock helper; reply locks; --list reads the catalog once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: One CapSolver helper behind the five solvers

Pure refactor. The existing tests are the guard: `test/captcha.test.js`, `test/captcha-coverage.test.js`, `test/captcha-egress.test.js`, `test/capsolver-optional.test.js`, `test/node-egress.test.js` (CapSolver test). Log text must stay byte-identical.

**Files:**
- Modify: `lib/captcha.js` (`solveRecaptcha`, `solveHcaptcha`, `solveTurnstile`, `solveRecaptchaV3`, `solveAwsWaf`)

**Interfaces:**
- Produces: internal `solveWithCapSolver(page, capsolver, spec)`; the five public solver signatures are unchanged.

- [ ] **Step 1: Run the guard tests green before touching anything**

Run: `node --require ./test/helpers/egress-off.js --test test/captcha.test.js test/captcha-coverage.test.js test/captcha-egress.test.js test/capsolver-optional.test.js test/node-egress.test.js`
Expected: PASS. Note the count.

- [ ] **Step 2: Add the helper above `solveRecaptcha`**

```js
const CAPSOLVER_CREATE_URL = 'https://api.capsolver.com/createTask';

/**
 * One CapSolver round trip, shared by every solver below: key check, value
 * extraction in the page, the Node egress gate, createTask, polling, token
 * injection. Resolves true only when the token reached the page. An
 * EgressError stops the run; any other failure is false for this broker.
 *
 * spec: { missingKey, solving, solved, errorLabel, extract, task(pageUrl, found),
 *         inject(solution) -> script, intervalMs? }
 */
async function solveWithCapSolver(page, capsolver, spec) {
  const key = capsolver?.apiKey;
  if (!key || isPlaceholderKey(key)) {
    console.log(`     info  ${spec.missingKey}`);
    return false;
  }
  try {
    const axios   = require('axios').create({ timeout: 30000, proxy: false });
    const pageUrl = page.url();
    const found = await page.evaluate(spec.extract);
    if (!found) return false;

    console.log(`     Solving ${spec.solving} via CapSolver...`);
    await ensureNodeEgress(); // CapSolver is Node-direct (audit M7)
    const { data: createData } = await axios.post(CAPSOLVER_CREATE_URL, { clientKey: key, task: spec.task(pageUrl, found) });
    const taskId = createData.taskId;
    if (!taskId) return false;

    const solution = await pollCapSolver(taskId, { clientKey: key, axios, ...(spec.intervalMs ? { intervalMs: spec.intervalMs } : {}) });
    if (!solution) return false;
    await page.evaluate(spec.inject(solution));
    console.log(`     ${spec.solved} solved`);
    return true;
  } catch (err) {
    if (err instanceof EgressError) throw err; // a failed egress check stops the run, not one broker
    console.log(`     CapSolver ${spec.errorLabel} error: ${err.message.slice(0, 60)}`);
    return false;
  }
}
```

- [ ] **Step 3: Replace the five solver bodies**

Keep each function's JSDoc. Each `extract` arrow is the existing `page.evaluate` callback body from that solver, moved unchanged.

```js
function solveRecaptcha(page, capsolver) {
  return solveWithCapSolver(page, capsolver, {
    missingKey: 'No CapSolver key - add one to config.json to auto-solve CAPTCHAs',
    solving: 'reCAPTCHA', solved: 'reCAPTCHA', errorLabel: 'reCAPTCHA',
    extract: () => {
      // Prefer a sitekey inside a form with a submit button or input (avoids header widgets)
      const formEl = Array.from(document.querySelectorAll('form')).find(
        f => f.querySelector('[data-sitekey]') &&
             (f.querySelector('input[type="submit"],button[type="submit"],button,input[type="text"],input[type="email"]'))
      );
      if (formEl) return formEl.querySelector('[data-sitekey]').getAttribute('data-sitekey');
      // Fall back to page-level first [data-sitekey]
      return document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') || null;
    },
    task: (websiteURL, websiteKey) => ({ type: 'ReCaptchaV2TaskProxyless', websiteURL, websiteKey }),
    inject: (solution) => findRecaptchaCallback(solution.gRecaptchaResponse),
  });
}

function solveHcaptcha(page, capsolver) {
  return solveWithCapSolver(page, capsolver, {
    missingKey: 'No CapSolver key - cannot solve hCAPTCHA automatically',
    solving: 'hCAPTCHA', solved: 'hCAPTCHA', errorLabel: 'hCAPTCHA',
    extract: () => {
      // Prefer a sitekey inside a form with a submit button or input (avoids header widgets)
      const formEl = Array.from(document.querySelectorAll('form')).find(
        f => f.querySelector('[data-sitekey]') &&
             (f.querySelector('input[type="submit"],button[type="submit"],button,input[type="text"],input[type="email"]'))
      );
      if (formEl) return formEl.querySelector('[data-sitekey]').getAttribute('data-sitekey');
      // Fall back to page-level [data-sitekey] or iframe src
      return document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') ||
        (document.querySelector('iframe[src*="hcaptcha"]')?.src || '').match(/sitekey=([^&]+)/)?.[1] || null;
    },
    task: (websiteURL, websiteKey) => ({ type: 'HCaptchaTaskProxyless', websiteURL, websiteKey }),
    inject: (solution) => buildHcaptchaScript(solution.gRecaptchaResponse || ''),
  });
}

function solveTurnstile(page, capsolver) {
  return solveWithCapSolver(page, capsolver, {
    missingKey: 'No CapSolver key - cannot solve Turnstile automatically',
    solving: 'Cloudflare Turnstile', solved: 'Turnstile', errorLabel: 'Turnstile',
    extract: () => {
      // Turnstile div carries data-sitekey
      const div = document.querySelector('.cf-turnstile[data-sitekey]') ||
                  document.querySelector('[data-sitekey][class*="cf-turnstile"]');
      if (div) return div.getAttribute('data-sitekey');
      // Fallback: extract from iframe src
      const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
      if (iframe) {
        const m = (iframe.src || '').match(/[?&]sitekey=([^&]+)/);
        if (m) return m[1];
      }
      return null;
    },
    task: (websiteURL, websiteKey) => ({ type: 'AntiTurnstileTaskProxyLess', websiteURL, websiteKey }),
    inject: (solution) => buildTurnstileScript(solution.token || ''),
  });
}

function solveRecaptchaV3(page, capsolver, broker) {
  return solveWithCapSolver(page, capsolver, {
    missingKey: 'No CapSolver key - cannot solve reCAPTCHA v3 automatically',
    solving: 'reCAPTCHA v3', solved: 'reCAPTCHA v3', errorLabel: 'reCAPTCHA v3',
    extract: () => {
      // Extract sitekey from render= query param in the v3 script tag
      const scripts = Array.from(document.querySelectorAll('script[src*="recaptcha/api.js"]'));
      for (const s of scripts) {
        const m = (s.src || '').match(/[?&]render=([^&]+)/);
        if (m && m[1] && m[1] !== 'explicit') return { siteKey: m[1] };
      }
      return null;
    },
    task: (websiteURL, found) => ({
      type: 'ReCaptchaV3TaskProxyLess',
      websiteURL,
      websiteKey: found.siteKey,
      pageAction: broker?.recaptchaV3Action || 'submit',
    }),
    inject: (solution) => buildRecaptchaV3Script(solution.gRecaptchaResponse || ''),
  });
}

function solveAwsWaf(page, capsolver) {
  return solveWithCapSolver(page, capsolver, {
    missingKey: 'No CapSolver key - cannot solve AWS WAF CAPTCHA automatically',
    solving: 'AWS WAF CAPTCHA', solved: 'AWS WAF CAPTCHA', errorLabel: 'AWS WAF',
    // Extract AWS WAF parameters from the page - these are injected by the WAF script
    extract: () => {
      const iframe = document.querySelector('iframe[src*="awswaf.com/captcha"]');
      if (!iframe) return null;
      const src = iframe.src || '';
      const awsKey  = src.match(/key=([^&]+)/)?.[1]    || null;
      const iv      = src.match(/iv=([^&]+)/)?.[1]     || null;
      const context = src.match(/context=([^&]+)/)?.[1] || null;
      if (!awsKey) return null;
      return { awsKey, iv, context };
    },
    task: (websiteURL, waf) => ({
      type: 'AntiAwsWafTask',
      websiteURL,
      awsKey:     waf.awsKey,
      awsIv:      waf.iv      || '',
      awsContext: waf.context || '',
      awsChallengeJS: '',
    }),
    // AWS WAF takes longer than reCAPTCHA - use 5s interval
    intervalMs: 5000,
    inject: (solution) => buildAwsWafScript(solution.cookie || solution.token || ''),
  });
}
```

The old functions were `async`; these return the helper's promise, which is the same contract. If a test checks `fn.constructor.name === 'AsyncFunction'`, mark them `async`.

- [ ] **Step 4: Run the guard tests**

Run: the Step 1 command.
Expected: PASS with the same count as Step 1. Then `npm test`: PASS. Check `wc -l lib/captcha.js` dropped by about 100 lines.

- [ ] **Step 5: Commit**

```bash
git add lib/captcha.js
git commit -m "refactor(captcha): one CapSolver round-trip helper behind the five solvers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Small cleanups (domain helpers, RECHECK_DAYS, emoji, header comment)

**Files:**
- Create: `lib/domain.js`, `test/domain.test.js`, `test/no-emoji-output.test.js`
- Modify: `lib/serp-scan.js`, `lib/broker-runner.js`, `lib/catalog.js`, `lib/catalog-drift.js`, `lib/catalog-survey-core.js`, `lib/catalog-sources.js`, `lib/feeds.js`, `lib/imap-confirm.js`, `generic-runner.js`, `watcher.js`, `setup.js`, `lib/hibp.js`, `test/hibp.test.js`, `dashboard/server.js`

**Interfaces:**
- Produces: `lib/domain.js` exports `{ hostnameOf(url) -> string, registrableDomain(hostname) -> string }` (same functions as before, moved).

- [ ] **Step 1: Write the failing tests**

Create `test/domain.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hostnameOf, registrableDomain } = require('../lib/domain');

test('the domain helpers live in lib/domain; serp-scan re-exports the same functions', () => {
  const serp = require('../lib/serp-scan');
  assert.equal(serp.hostnameOf, hostnameOf);
  assert.equal(serp.registrableDomain, registrableDomain);
  assert.equal(hostnameOf('https://www.example.com/x'), 'example.com');
  assert.equal(registrableDomain('opt.out.example.com'), 'example.com');
});

test('nothing outside serp-watch imports serp-scan just for the domain helpers', () => {
  const files = ['generic-runner.js', 'lib/broker-runner.js', 'lib/catalog.js', 'lib/catalog-drift.js', 'lib/catalog-survey-core.js', 'lib/catalog-sources.js', 'lib/feeds.js', 'lib/imap-confirm.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/require\(['"][./]*(lib\/)?serp-scan['"]\)/.test(src), `${f} still imports serp-scan`);
  }
});

test('generic-runner takes RECHECK_DAYS from lib/config', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'generic-runner.js'), 'utf8');
  assert.ok(!/const RECHECK_DAYS\s*=/.test(src));
});
```

Create `test/no-emoji-output.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PICTO = /\p{Extended_Pictographic}/u;

test('no emoji in tracked source outside tests and the dashboard UI', () => {
  const files = execFileSync('git', ['ls-files', '-z', '*.js'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(f => f && !f.startsWith('test/') && !f.startsWith('dashboard/public/') && !f.endsWith('.test.js'));
  const offenders = [];
  for (const f of files) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (PICTO.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --require ./test/helpers/egress-off.js --test test/domain.test.js test/no-emoji-output.test.js`
Expected: FAIL (`lib/domain` missing; offenders in `watcher.js`, `setup.js`, `lib/hibp.js`).

- [ ] **Step 3: Move the domain helpers**

Create `lib/domain.js` with this header, then move `hostnameOf` and `registrableDomain` from `lib/serp-scan.js` into it unchanged, with their JSDoc:

```js
'use strict';
/**
 * lib/domain.js
 *
 * Hostname helpers shared by the runners, the catalog and the SERP scan.
 * registrableDomain keeps the last two labels; it does not know multi-part
 * suffixes such as co.uk.
 */
```

End it with `module.exports = { hostnameOf, registrableDomain };`. In `lib/serp-scan.js` delete the two functions and add `const { hostnameOf, registrableDomain } = require('./domain');` near its other requires (its `module.exports` keeps both names, so they are re-exported). In each of `lib/broker-runner.js`, `lib/catalog.js`, `lib/catalog-drift.js`, `lib/catalog-survey-core.js`, `lib/catalog-sources.js`, `lib/feeds.js`, `lib/imap-confirm.js` change `require('./serp-scan')` to `require('./domain')`; in `generic-runner.js` change `require('./lib/serp-scan')` to `require('./lib/domain')`.

- [ ] **Step 4: RECHECK_DAYS, emoji, header comment**

- `generic-runner.js`: delete `const RECHECK_DAYS = 90;` and change the config import to `const { CONFIRM_RECHECK_DAYS, RECHECK_DAYS, loadConfig } = require('./lib/config');`.
- `watcher.js`: in `PREVIEW_ALIAS_NOTE` and the `config.notify` line, replace the leading `ℹ  ` with `Note: `.
- `setup.js` (two lines in the existing-config notice): replace the leading `ℹ  ` with `Note: `.
- `lib/hibp.js`: in the breach-to-broker line replace ` ↔ broker ` with ` <-> broker `; in `test/hibp.test.js` change the matching assert to `/SpokeoLeak \(spokeo\.com\) <-> broker "Spokeo"/`.
- `dashboard/server.js` header comment: `(X-UPEC_WIPE-Token)` becomes `(X-UPEC-WIPE-Token)`.

- [ ] **Step 5: Run the tests**

Run: `node --require ./test/helpers/egress-off.js --test test/domain.test.js test/no-emoji-output.test.js test/hibp.test.js test/serp-scan.test.js test/catalog*.test.js`
Expected: PASS. If a setup test pins the `ℹ` text, update it to `Note: `. Then `npm test` and `node --test dashboard/*.test.js`: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A lib/ generic-runner.js watcher.js setup.js dashboard/server.js test/
git commit -m "refactor: lib/domain.js, one RECHECK_DAYS, no emoji in output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Final verification and hand-off

**Files:** none changed unless a check fails.

- [ ] **Step 1: Full verification**

Run: `npm test` and `node --test dashboard/*.test.js` and `UPEC_WIPE_BROWSER_TESTS=1 node --test test/generic-selectors.browser.test.js test/field-resolver.browser.test.js`
Expected: all PASS. Record the counts and the `npm test` duration for the PR text.

- [ ] **Step 2: House-style and leftovers**

Run: `git grep -n "sendKnowRequests\|sendOptOutEmails\|handlePrivacyManager\|_resetNodeEgress()" -- '*.js' ':!test/'`
Expected: only the `_resetNodeEgress` definition and export in `lib/egress.js`.

- [ ] **Step 3: Personal-data check before any push (ask the member first)**

This is the established pre-push check. It loads `config.json` inside a process and prints only file names and counts, never values. Do not run it without the member's OK; offer it to them to run with the `!` prefix:

```bash
node -e '
const cfg=require("./lib/config").loadConfig();const vals=new Set();
const walk=o=>{for(const v of Object.values(o||{})){if(v&&typeof v==="object")walk(v);else if(typeof v==="string"&&v.trim().length>=4)vals.add(v.trim().toLowerCase());}};
walk(cfg.persons||[cfg.person]);
const {execSync}=require("child_process");
const diff=execSync("git diff upec/hardening...HEAD",{maxBuffer:1e8}).toString().toLowerCase();
const msgs=execSync("git log --format=%B upec/hardening..HEAD").toString().toLowerCase();
let hits=0;for(const v of vals){if(diff.includes(v)||msgs.includes(v))hits++;}
console.log("personal values found in branch diff or messages:",hits);'
```

Expected: `0`. Any hit: stop and show the member which file (not the value).

- [ ] **Step 4: Hand back**

Do not push or open a PR without the member's go-ahead. When they agree:

```bash
git push -u origin upec/review-overhaul
gh pr create --base upec/hardening --title "Review overhaul: privacy gaps P1-P6, speed, cleanup" --body "<summary of tasks 1-12, test counts and duration from Step 1, and the behaviour changes members will notice: no relay block now blocks submissions; --know needs the email block and SEND; --breach-check asks for YES>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Tell the member separately: moving the clone to the WSL filesystem (`git clone` into `~/upec-wipe`, then copy their own `config.json`/`state.json` themselves) makes catalog reads about 100 times faster.
