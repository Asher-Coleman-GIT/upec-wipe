# Broker Reality Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every broker result honest after the first live preview (2026-10-10) showed empty-form submits, bot-wall pages counted as "Not listed", dead brokers, misleading preview output and California-only items shown to a Utah resident.

**Architecture:** One new pure module (`lib/block-page.js`) recognises bot-protection and block pages. `findListingUrl` throws on a block page, so both the run and `--verify` stop treating a blocked search as "not listed / verified clear". `fillForm` returns what it filled; `processBrokerWithPerson` refuses to submit a form when nothing was filled and turns block pages into `manual` with a reason. Preview prints only what the tool filled and is counted in its own bucket. `brokers.js` is corrected from a read-only live survey (below) and gains a `states` filter so the California entry only runs for CA residents. A maintenance script repeats the survey on demand.

**Tech Stack:** Node 22, CommonJS, `node:test`, Playwright Chromium (already a dependency). No new dependencies.

**Spec:** this document. The source is the user's request on 2026-10-10 ("do 1-4 along with removing the items that do not apply (california stuff)") against the four steps listed in the conversation, plus the live survey below.

## Live survey (2026-10-10, Mullvad US exit, read-only, dummy person, nothing submitted)

| Broker | What loads now | Decision |
|---|---|---|
| Spokeo | Form: `input[name="url"]`, `input[name="email"]`, button OPT OUT | keep, unchanged |
| FastPeopleSearch | `#firstname`, `#lastname`, `#email`, `input[name="legal"]` checkbox, CAPTCHA | repair selectors, `captchaLikely: true` |
| USPhonebook | `#subject-firstname`, `#subject-lastname`, `#subject-email`, `#agreement`, CAPTCHA | repair, `captchaLikely: true` |
| PeopleSearchNow | same form as USPhonebook | repair, `captchaLikely: true` |
| SearchPeopleFree | `#o_first`, `#o_last`, `#o_email`, `#o_terms`, CAPTCHA | repair, `captchaLikely: true` |
| SocialCatfish | `#first-name`, `#last-name`, `#email` (a second `name="email"` input is a newsletter box), `#consent-checkbox` = "receive promotional Emails and SMS" (must never be ticked), CAPTCHA | repair with id selectors only, `captchaLikely: true` |
| PrivateRecords | radio `#r-removal`, `#oo-email` | repair |
| DataAxle | HubSpot form, `input[name="email"]` | keep, tighten selector |
| TruePeopleSearch, WhitePages, BeenVerified, PeopleFinders, MyLife, FamilyTreeNow, CheckPeople, ThatsThem, SmartBackgroundChecks, NationalPublicData | Cloudflare challenge ("Just a moment…", "Attention Required!", "Error 1005 Access denied", "Checking your browser") that never clears for automation | keep definitions; the new block-page check turns these into `manual` with the link at run time (they may load from another Mullvad server) |
| Intelius, TruthFinder, InstantCheckmate | 404 / redirect to `https://suppression.peopleconnect.us/login` (email + emailed code) | replace all three with one manual entry "PeopleConnect Suppression Center" |
| AnyWho | redirects to `https://www.spokeo.com/optout` | remove (covered by Spokeo) |
| Radaris, PeekYou | domain "Transferred by Court Order" to Atlas Data Privacy Corp | remove |
| Nuwber | no A record | remove |
| PublicDataUSA | NXDOMAIN | remove |
| ClustrMaps | resolves to 127.0.0.1 | remove |
| PeopleSmart | `/help/` now a B2B leads site, no consumer opt-out | remove |
| Oracle Data Cloud | page is "Data services contracts"; Oracle closed its ad business | remove |
| Equifax (marketing) 404, Experian (marketing) info page with CAPTCHA | official joint opt-out is `https://www.optoutprescreen.com/` | replace both with one manual entry "OptOutPrescreen (Equifax, Experian, TransUnion, Innovis)" |
| ZoomInfo | 404; live page `https://www.zoominfo.com/trust-center/your-privacy` | manual |
| Epsilon | 404; live page `https://legal.epsilon.com/dsr` (CAPTCHA, multi-select) | manual |
| Acxiom | form inside an iframe from `isapps.acxiom.com`, which redirects when opened directly | manual, `https://www.acxiom.com/optout/` |
| LexisNexis | multi-step portal, no form on the page | manual, `https://consumer.risk.lexisnexis.com/opt` |
| InfoTracer | "Are you human?" check | manual, `https://infotracer.com/optout/` |
| Clearbit | opt-out page 404; only the privacy policy remains | manual, `https://clearbit.com/privacy-policy` |
| Addresses.com | `optout.php` 404, no opt-out link found | manual, note says the page is gone |
| California DELETE Portal + CalPrivacy DROP | DROP is live at `https://privacy.ca.gov/drop/` | replace both with one manual entry "California DROP", `states: ['CA']` |

## Global Constraints

- Never log or persist a filled value: printed preview lines may show values (stdout only), and the `persistedDetail` argument of `logResult` must stay value-free (audit L11).
- A `manual` result's detail must contain the broker URL to open, so it lands in "Action Required".
- Do not add dependencies. Do not change `--generic` behaviour.
- Tests run with `npm test` (root) and `cd dashboard && node --test` (dashboard). Both must pass before every commit.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No personal data in fixtures: use Jane Doe / `jane@example.com`.

## Review Focus

1. A block page served with HTTP 200 (TruePeopleSearch's challenge returns 403, but others return 200): detection must use title and text, not only status. Pinned in Task 1 (`200 challenge page` test).
2. `--verify` on a blocked search page must report "unverifiable", never "verified_clear". Pinned in Task 2.
3. A form where only a checkbox or the listing URL got filled: the checkbox alone must not count as "filled" (a consent box is not identifying data), the listing URL must. Pinned in Task 3.
4. Preview of a broker whose form is unrecognised must say so, not print "would POST". Pinned in Task 3.
5. A CA resident must still get the California DROP entry; a person with no state must not. Pinned in Task 5.

---

### Task 1: Recognise block pages

**Files:**
- Create: `lib/block-page.js`
- Test: `test/block-page.test.js`

**Interfaces:**
- Produces: `detectBlockPage({ status, title, text }) -> string | null` (a short human reason, or null), `class BlockedPageError extends Error` with `.reason`, `async function checkPageBlocked(page, resp) -> string | null`.

- [ ] **Step 1: Write the failing test**

```js
// test/block-page.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectBlockPage, BlockedPageError, checkPageBlocked } = require('../lib/block-page');

test('Cloudflare interstitial is a block page', () => {
  assert.match(detectBlockPage({ status: 403, title: 'Just a moment...', text: 'Performing security verification' }), /bot protection/);
});
test('Cloudflare hard block is a block page', () => {
  assert.ok(detectBlockPage({ status: 403, title: 'Attention Required! | Cloudflare', text: 'Sorry, you have been blocked' }));
  assert.ok(detectBlockPage({ status: 403, title: 'Access denied | x.com used Cloudflare to restrict access', text: 'Error 1005' }));
});
test('200 challenge page is still a block page', () => {
  assert.ok(detectBlockPage({ status: 200, title: '', text: 'Are you human? You are accessing a page that needs extra human verification' }));
  assert.ok(detectBlockPage({ status: 200, title: 'Checking your browser', text: '' }));
  assert.ok(detectBlockPage({ status: 403, title: 'Access to this page has been denied', text: 'Press & Hold to confirm you are a human' }));
});
test('a normal opt-out page is not a block page', () => {
  assert.equal(detectBlockPage({ status: 200, title: 'Opt-Out Request Start - FastPeopleSearch', text: 'First Name Last Name Email' }), null);
});
test('a plain 403 with no challenge text is still treated as blocked', () => {
  assert.match(detectBlockPage({ status: 403, title: 'Forbidden', text: '' }), /HTTP 403/);
});
test('BlockedPageError carries the reason', () => {
  const e = new BlockedPageError('blocked by bot protection');
  assert.equal(e.reason, 'blocked by bot protection');
  assert.equal(e.name, 'BlockedPageError');
});
test('checkPageBlocked reads title and text from the page', async () => {
  const page = { title: async () => 'Just a moment...', evaluate: async () => 'Performing security verification' };
  assert.ok(await checkPageBlocked(page, { status: () => 403 }));
  const ok = { title: async () => 'Opt out', evaluate: async () => 'Email' };
  assert.equal(await checkPageBlocked(ok, { status: () => 200 }), null);
  assert.equal(await checkPageBlocked(ok, null), null, 'no response object (same-document nav) is fine');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/block-page.test.js`
Expected: FAIL, `Cannot find module '../lib/block-page'`.

- [ ] **Step 3: Implement**

```js
// lib/block-page.js
'use strict';
/**
 * Recognise bot-protection and block pages (Cloudflare, PerimeterX, generic
 * "are you human" checks). These never clear for an automated browser, so a
 * run must not fill them, and a search must not read them as "not listed".
 */

const PATTERNS = [
  /just a moment\.\.\./i,
  /attention required!?\s*\|\s*cloudflare/i,
  /used cloudflare to restrict access/i,
  /you have been blocked/i,
  /performing security verification/i,
  /checking your browser/i,
  /are you human\?/i,
  /press & hold to confirm you are a human/i,
  /access to this page has been denied/i,
  /please complete the security challenge/i,
];

function detectBlockPage({ status, title, text } = {}) {
  const hay = `${title || ''}\n${text || ''}`;
  if (PATTERNS.some(re => re.test(hay))) return 'blocked by bot protection';
  if (status === 403 || status === 429) return `blocked (HTTP ${status})`;
  return null;
}

class BlockedPageError extends Error {
  constructor(reason) { super(reason); this.name = 'BlockedPageError'; this.reason = reason; }
}

async function checkPageBlocked(page, resp) {
  const status = resp && typeof resp.status === 'function' ? resp.status() : null;
  const title = await page.title().catch(() => '');
  const text = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 2000) : '')).catch(() => '');
  return detectBlockPage({ status, title, text });
}

module.exports = { detectBlockPage, BlockedPageError, checkPageBlocked };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test test/block-page.test.js` — Expected: 7 pass.

- [ ] **Step 5: Commit**

```bash
git add lib/block-page.js test/block-page.test.js
git commit -m "feat: recognise bot-protection and block pages"
```

---

### Task 2: Blocked or failed searches are not "Not listed" (run and --verify)

**Files:**
- Modify: `lib/forms.js` (`findListingUrl`)
- Modify: `lib/broker-runner.js:86-97` (search step)
- Test: `test/forms-find-listing-blocked.test.js`, `test/broker-runner-blocked.test.js`, extend `test/verify-loop.test.js`

**Interfaces:**
- Consumes: `checkPageBlocked`, `BlockedPageError` from Task 1.
- Produces: `findListingUrl(page, broker)` now throws `BlockedPageError` on a block page and rethrows navigation errors; still returns `string | null` otherwise.

- [ ] **Step 1: Write the failing tests**

```js
// test/forms-find-listing-blocked.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.TURBO = '1';
const { findListingUrl } = require('../lib/forms');
const { BlockedPageError } = require('../lib/block-page');

const broker = { searchUrl: 'https://broker.example/search', listingPattern: /broker\.example\/p\//i };
function page({ title = 'Results', text = 'results', status = 200, links = [] } = {}) {
  return {
    goto: async () => ({ status: () => status }),
    title: async () => title,
    evaluate: async (fn, arg) => (arg ? links.filter(h => new RegExp(arg.src, arg.flags).test(h)) : text),
  };
}

test('a matching link is returned', async () => {
  assert.equal(await findListingUrl(page({ links: ['https://broker.example/p/1'] }), broker), 'https://broker.example/p/1');
});
test('a loaded page with no match returns null (genuinely not listed)', async () => {
  assert.equal(await findListingUrl(page({ links: [] }), broker), null);
});
test('a challenge page throws BlockedPageError instead of returning null', async () => {
  await assert.rejects(findListingUrl(page({ title: 'Just a moment...', status: 403 }), broker), BlockedPageError);
});
test('a navigation failure is rethrown', async () => {
  const p = page(); p.goto = async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); };
  await assert.rejects(findListingUrl(p, broker), /ERR_NAME_NOT_RESOLVED/);
});
```

```js
// test/broker-runner-blocked.test.js  (Module._load interception as in broker-runner-preview.test.js)
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const originalLoad = Module._load.bind(Module);
const logged = [];
let findImpl = async () => null;
let blockedReason = null;
const configMock = {
  shouldSkip: () => null, saveCheckpoint: () => {}, stateKey: n => n,
  recordSuccess: () => {}, recordPendingConfirmation: () => {}, recordFailure: () => {},
};
Module._load = function (request, parent, isMain) {
  if (!parent?.filename?.includes('broker-runner')) return originalLoad(request, parent, isMain);
  if (request === './config') return configMock;
  if (request === './logger') return { logResult: (name, status, detail) => logged.push({ name, status, detail }) };
  if (request === './forms') return { fillForm: async () => ({ filled: [{ selector: '#first', value: 'Jane', kind: 'text' }], missed: [] }), findListingUrl: (...a) => findImpl(...a) };
  if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlocked: async () => blockedReason };
  if (request === './timing') return { jitterSleep: async () => {} };
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/broker-runner')];
const { configure, processBroker } = require('../lib/broker-runner');
Module._load = originalLoad;
const { BlockedPageError } = require('../lib/block-page');

const ctx = { newPage: async () => ({ goto: async () => ({ status: () => 200 }), close: async () => {}, locator: () => ({ first: () => ({ count: async () => 0 }) }) }) };
const SEARCH = { name: 'S', method: 'search-form', searchUrl: 'https://s.example/q', listingPattern: /x/, optOutUrl: 'https://s.example/optout', formFields: { '#first': 'Jane' } };
const DIRECT = { name: 'D', method: 'direct-form', optOutUrl: 'https://d.example/optout', formFields: { '#first': 'Jane' } };

test('a blocked search page is manual with the opt-out link, not notFound', async () => {
  logged.length = 0; blockedReason = null;
  findImpl = async () => { throw new BlockedPageError('blocked by bot protection'); };
  configure({ dryRun: true, preview: false, person: { country: 'US' } });
  await processBroker(ctx, SEARCH);
  assert.equal(logged[0].status, 'manual');
  assert.match(logged[0].detail, /bot protection/);
  assert.match(logged[0].detail, /https:\/\/s\.example\/optout/);
});
test('a search that fails to load is an error, not notFound', async () => {
  logged.length = 0; blockedReason = null;
  findImpl = async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); };
  configure({ dryRun: true, preview: false, person: { country: 'US' } });
  await processBroker(ctx, SEARCH);
  assert.equal(logged[0].status, 'error');
  assert.match(logged[0].detail, /search page did not load/);
});
test('a blocked opt-out page is manual with the link', async () => {
  logged.length = 0; blockedReason = 'blocked by bot protection';
  configure({ dryRun: true, preview: false, person: { country: 'US' } });
  await processBroker(ctx, DIRECT);
  assert.equal(logged[0].status, 'manual');
  assert.match(logged[0].detail, /https:\/\/d\.example\/optout/);
});
```

Add to `test/verify-loop.test.js`, after the existing "findListingUrl throws → unverifiable" test. It reuses that file's `searchBroker` and `makeState` helpers and drives the **real** `findListingUrl` against a challenge page, so it fails until `findListingUrl` throws on block pages:

```js
test('a challenge page on the verify search is unverifiable, never verified_clear', async () => {
  process.env.TURBO = '1';
  const { findListingUrl } = require('../lib/forms');
  const broker  = searchBroker('WalledBroker');
  const person  = { firstName: 'Jane', lastName: 'Doe' };
  const state   = makeState('WalledBroker', 8);
  const challengePage = {
    goto: async () => ({ status: () => 403 }),
    title: async () => 'Just a moment...',
    evaluate: async (fn, arg) => (arg ? [] : 'Performing security verification'),
    close: async () => {},
  };
  const context = { newPage: async () => challengePage };

  const result = await runVerify(context, [broker], [person], { findUrl: findListingUrl, state });

  assert.equal(result.verified_clear.length, 0, 'a blocked search must never confirm deletion');
  assert.equal(result.unverifiable.length, 1);
  assert.match(result.unverifiable[0].reason, /bot protection/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --require ./test/helpers/egress-off.js --test test/forms-find-listing-blocked.test.js test/broker-runner-blocked.test.js test/verify-loop.test.js`
Expected: the "challenge page throws", "blocked search page is manual", "fails to load is an error", "blocked opt-out page" and "challenge page on the verify search" tests FAIL (the last one currently records `verified_clear`).

- [ ] **Step 3: Implement**

In `lib/forms.js`, add `const { checkPageBlocked, BlockedPageError } = require('./block-page');` and change the first two lines of `findListingUrl`:

```js
async function findListingUrl(page, broker) {
  const resp = await page.goto(broker.searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await jitterSleep(1500, 2500);
  // A challenge or block page has no listing links; reading it as "not listed"
  // made the run say nothing to remove and --verify say "verified clear".
  const blocked = await checkPageBlocked(page, resp);
  if (blocked) throw new BlockedPageError(blocked);
```

(keep the rest of the function as is).

In `lib/broker-runner.js`, add `const { checkPageBlocked, BlockedPageError } = require('./block-page');` and replace the search step:

```js
    if (broker.method === 'search-form' && broker.searchUrl) {
      try {
        listingUrl = await findListingUrl(page, broker);
      } catch (err) {
        if (err instanceof EgressError) throw err;
        if (err instanceof BlockedPageError) {
          logResult(broker.name, 'manual', `${err.reason} - open in your normal browser: ${broker.optOutUrl}`);
          return;
        }
        logResult(broker.name, 'error', `search page did not load: ${redactUrlsInText(err.message || '').split('\n')[0].slice(0, 80)}`);
        recordFailure(key, 'error');
        return;
      }
      if (!listingUrl) {
```

(Keep the existing `if (broker.method === ...)` condition text that is already on that line; only the `findListingUrl(...).catch(() => null)` call changes. The `finally` block closes the page.)

After the opt-out navigation's HTTP 404/410/5xx guard, add:

```js
    const blocked = await checkPageBlocked(page, navResp);
    if (blocked) {
      logResult(broker.name, 'manual', `${blocked} - open in your normal browser: ${broker.optOutUrl}`);
      return;
    }
```

- [ ] **Step 4: Run tests**

Run: `node --require ./test/helpers/egress-off.js --test test/forms-find-listing-blocked.test.js test/broker-runner-blocked.test.js test/verify-loop.test.js test/broker-runner-*.test.js test/forms-*.test.js`
Expected: all pass. If an older broker-runner test mocks `./forms` with a page lacking `title`, `checkPageBlocked` swallows the error (`.catch(() => '')`) and returns null for status 200, so those tests keep passing; fix any that do not by adding `title: async () => ''` to their page stub.

- [ ] **Step 5: Commit**

```bash
git add lib/forms.js lib/broker-runner.js test/forms-find-listing-blocked.test.js test/broker-runner-blocked.test.js test/verify-loop.test.js
git commit -m "fix: a blocked or failed search is not 'not listed' or 'verified clear'"
```

---

### Task 3: Never submit an empty form; preview shows only what was filled

**Files:**
- Modify: `lib/forms.js` (`fillForm` return value)
- Modify: `lib/broker-runner.js` (fill step, preview step)
- Test: `test/forms-fill-report.test.js`, `test/broker-runner-empty-form.test.js`, update `test/broker-runner-preview.test.js`

**Interfaces:**
- Produces: `fillForm(...) -> { filled: Array<{ selector, value, kind }>, missed: string[] }` where `kind` is `'text' | 'select' | 'checkbox'`. Callers that ignore the return value keep working.
- A fill "counts" (is identifying) when `kind !== 'checkbox'`. Listing-URL injection counts.

- [ ] **Step 1: Write the failing tests**

```js
// test/forms-fill-report.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fillForm } = require('../lib/forms');

function stubPage({ present = [], types = {} } = {}) {
  const locator = (sel) => {
    const self = {
      first: () => self,
      count: async () => (present.includes(sel) ? 1 : 0),
      isVisible: async () => present.includes(sel),
      evaluate: async (fn) => fn({ tagName: 'INPUT', type: types[sel] || 'text' }),
      fill: async () => {}, selectOption: async () => {}, check: async () => {},
    };
    return self;
  };
  return {
    locator,
    getByLabel: () => ({ count: async () => 0, first: () => ({ fill: async () => {} }) }),
    evaluate: async () => null, // semantic resolver finds nothing
    $$: async () => [],
  };
}

test('fillForm reports filled and missed selectors', async () => {
  const r = await fillForm(stubPage({ present: ['#first'] }), { '#first': 'Jane', '#last': 'Doe' });
  assert.deepEqual(r.filled.map(f => f.selector), ['#first']);
  assert.equal(r.filled[0].value, 'Jane');
  assert.equal(r.filled[0].kind, 'text');
  assert.deepEqual(r.missed, ['#last']);
});
test('a checkbox fill is reported with kind checkbox', async () => {
  const r = await fillForm(stubPage({ present: ['#agree'], types: { '#agree': 'checkbox' } }), { '#agree': 'on' });
  assert.equal(r.filled[0].kind, 'checkbox');
});
test('empty values are neither filled nor missed', async () => {
  const r = await fillForm(stubPage(), { '#middle': '' });
  assert.deepEqual(r, { filled: [], missed: [] });
});
```

```js
// test/broker-runner-empty-form.test.js  (same Module._load pattern as Task 2's runner test;
// copy that file's header, and make the './forms' mock return `fillResult`)
let fillResult = { filled: [], missed: ['#first', '#last'] };
// ... header as in test/broker-runner-blocked.test.js, with:
//   if (request === './forms') return { fillForm: async () => fillResult, findListingUrl: async () => null };
//   if (request === './block-page') return { ...originalLoad(request, parent, isMain), checkPageBlocked: async () => null };

const BROKER = { name: 'E', method: 'direct-form', optOutUrl: 'https://e.example/optout', submitSelector: 'button', formFields: { '#first': 'Jane', '#last': 'Doe' } };

test('real run: nothing filled -> manual with the link, no submit', async () => {
  logged.length = 0; fillResult = { filled: [], missed: ['#first', '#last'] };
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, BROKER);
  assert.equal(logged[0].status, 'manual');
  assert.match(logged[0].detail, /form not recognised/);
  assert.match(logged[0].detail, /https:\/\/e\.example\/optout/);
});
test('real run: only a checkbox filled still counts as nothing filled', async () => {
  logged.length = 0; fillResult = { filled: [{ selector: '#agree', value: 'on', kind: 'checkbox' }], missed: ['#first'] };
  configure({ dryRun: false, preview: false, person: { country: 'US' } });
  await processBroker(ctx, BROKER);
  assert.equal(logged[0].status, 'manual');
});
test('preview: nothing filled says so instead of "would POST"', async () => {
  logged.length = 0; fillResult = { filled: [], missed: ['#first'] };
  configure({ dryRun: true, preview: true, person: { country: 'US' } });
  await processBroker(ctx, BROKER);
  assert.equal(logged[0].status, 'manual');
  assert.doesNotMatch(logged[0].detail, /would POST/);
});
test('preview: lists only the fields the tool filled, with checkbox state', async () => {
  logged.length = 0;
  fillResult = { filled: [{ selector: '#first', value: 'Jane', kind: 'text' }, { selector: '#agree', value: 'on', kind: 'checkbox' }], missed: ['#last'] };
  configure({ dryRun: true, preview: true, person: { country: 'US' } });
  await processBroker(ctx, BROKER);
  const e = logged.find(l => l.status === 'preview');
  assert.match(e.detail, /#first="Jane"/);
  assert.match(e.detail, /#agree=checked/);
  assert.match(e.detail, /not found: #last/);
  assert.match(e.detail, /would submit to https:\/\/e\.example\/optout/);
});
```

In `test/broker-runner-preview.test.js`, the `./forms` mock returns `{ filled: [{ selector: 'first', value: 'Jane', kind: 'text' }, { selector: 'email', value: 'jane@example.com', kind: 'text' }], missed: [] }`; change `/radaris\.com\/optout/` expectations to the new "would submit to" wording only where the old text "would POST" is asserted.

- [ ] **Step 2: Run to verify failure**

Run: `node --require ./test/helpers/egress-off.js --test test/forms-fill-report.test.js test/broker-runner-empty-form.test.js test/broker-runner-preview.test.js`
Expected: FAIL (`fillForm` returns undefined; runner still prints the page-wide dump).

- [ ] **Step 3: Implement**

`lib/forms.js` `fillForm`: create `const report = { filled: [], missed: [] };` before the loop. Wherever the code sets `filled = true`, also push the result, computing `kind` from the element it already inspected:

```js
const kindOf = (tag, type) => (tag === 'select' ? 'select' : (type === 'checkbox' || type === 'radio') ? 'checkbox' : 'text');
```

- direct selector branch: after the fill/select/check, `report.filled.push({ selector, value: String(value), kind: kindOf(tag, type) });`
- getByLabel branch: `report.filled.push({ selector, value: String(value), kind: 'text' });`
- semantic resolver branch: after the fill/select/check, `report.filled.push({ selector, value: String(value), kind: kindOf(tag, type) });`
- after both fallbacks, if still not filled: `report.missed.push(selector);`

End the function with `return report;`. Empty values `continue` before any of this, so they appear in neither list.

`lib/broker-runner.js` fill step:

```js
    let fill = { filled: [], missed: [] };
    if (broker.formFields) {
      fill = (await fillForm(page, broker.formFields, person, opts.submissionEmail || undefined)) || fill;
      await jitterSleep(400, 800);
      // Audit 2026-10-10: most live forms had drifted, and the run clicked submit
      // on an empty form. A consent checkbox is not identifying data; a listing
      // URL is.
      const identifying = fill.filled.filter(f => f.kind !== 'checkbox').length + (listingUrl ? 1 : 0);
      if (identifying === 0) {
        logResult(broker.name, 'manual', `form not recognised (none of your details could be filled) - do it by hand: ${broker.optOutUrl}`);
        return;
      }
    }
```

Replace the preview block (Step 4b) body with:

```js
    if (opts.preview) {
      const shown = fill.filled.map(f => (f.kind === 'checkbox' ? `${f.selector}=checked` : `${f.selector}="${f.value}"`));
      if (listingUrl) shown.unshift(`listing="${listingUrl}"`);
      const missed = fill.missed.length ? ` | not found: ${fill.missed.join(', ')}` : '';
      const detail = `${shown.join(' ')}${missed} → would submit to ${broker.optOutUrl}`;
      logResult(broker.name, 'preview', detail, `preview - ${fill.filled.length} field(s) filled, ${fill.missed.length} not found, values not persisted`);
      await page.close();
      return;
    }
```

- [ ] **Step 4: Run tests** — the three files above plus `test/forms-*.test.js test/broker-runner-*.test.js`; all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/forms.js lib/broker-runner.js test/forms-fill-report.test.js test/broker-runner-empty-form.test.js test/broker-runner-preview.test.js
git commit -m "fix: never submit an empty form; preview shows only filled fields"
```

---

### Task 4: Honest summary counts

**Files:**
- Modify: `lib/logger.js`
- Test: extend `test/logger.test.js`

**Interfaces:**
- Produces: `results.previewed` bucket; `STATUS_BUCKET.preview === 'previewed'`.

- [ ] **Step 1: Failing tests** (append to `test/logger.test.js`, which already imports `logResult`, `resetResults`, `buildSummary`, `results`):

```js
test('previews have their own bucket and summary line', () => {
  resetResults();
  logResult('A', 'preview', 'x');
  logResult('B', 'skipped', 'done 3 days ago');
  assert.equal(results.previewed.length, 1);
  assert.equal(results.skipped.length, 1);
  const s = buildSummary();
  assert.match(s, /Previewed \(not submitted\):\s+1/);
  assert.match(s, /Skipped \(done recently\):\s+1/);
  assert.doesNotMatch(s, /Skipped \(fresh\)/);
});
test('no preview line on a real run', () => {
  resetResults();
  assert.doesNotMatch(buildSummary(), /Previewed/);
});
test('no generic line when the generic pass did not run', () => {
  resetResults();
  results.genericStats = {};
  assert.doesNotMatch(buildSummary(), /Generic runner/);
});
```

- [ ] **Step 2: Run** `node --test test/logger.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement** in `lib/logger.js`:
  - add `previewed: []` to `results`, and `'previewed'` to the `resetResults` key list;
  - `STATUS_BUCKET.preview = 'previewed'`;
  - `const genericLine = gs && gs.attempted !== undefined ? ... : '';`
  - replace the skipped line with `` `⏭  Skipped (done recently):   ${results.skipped.length}` `` and insert after it `results.previewed.length ? `👀 Previewed (not submitted): ${results.previewed.length}` : ''`.
  - grep for other readers of `results.skipped` that expected previews (`grep -rn "results.skipped\|\.skipped" lib watcher.js dashboard/server.js`) and confirm none counted previews on purpose.

- [ ] **Step 4: Run** `npm test` — all pass (update any assertion that matched "Skipped (fresh)").

- [ ] **Step 5: Commit** `git commit -am "fix(summary): count previews separately; drop empty generic line"`

---

### Task 5: California entry only for California residents

**Files:**
- Modify: `brokers.js` (remove "California DELETE Portal" and "CalPrivacy DROP", add "California DROP")
- Modify: `lib/broker-runner.js` (states filter beside the usOnly check)
- Modify: `lib/right-to-know-runner.js` only if it iterates manual brokers (check with grep; it filters `method === 'email'`, so no change expected)
- Test: replace `test/brokers-ca-delete.test.js` and `test/brokers-caldrop.test.js` with `test/brokers-california.test.js`; add a case to `test/broker-runner-usonly.test.js`

**Interfaces:**
- Produces: optional broker field `states: string[]` (2-letter, upper case). A broker with `states` is silently skipped (no log line) for a person whose `state` is not in the list.

- [ ] **Step 1: Failing tests**

```js
// test/brokers-california.test.js (keep the config.example.json Module._load shim from the old files)
test('one California DROP entry, manual, CA only, official link', () => {
  const e = brokers.find(b => b.name === 'California DROP');
  assert.ok(e);
  assert.equal(e.method, 'manual');
  assert.deepEqual(e.states, ['CA']);
  assert.equal(e.optOutUrl, 'https://privacy.ca.gov/drop/');
  assert.equal(brokers.find(b => b.name === 'California DELETE Portal'), undefined);
  assert.equal(brokers.find(b => b.name === 'CalPrivacy DROP'), undefined);
});
```

In `test/broker-runner-usonly.test.js` (same harness already present there):

```js
test('a states-limited broker is silent for a person outside those states', async () => {
  logged.length = 0;
  configure({ dryRun: true, person: { country: 'US', state: 'UT' } });
  await processBroker(ctx, { name: 'CA only', method: 'manual', states: ['CA'], optOutUrl: 'https://x' });
  assert.equal(logged.length, 0);
});
test('a states-limited broker runs for a resident', async () => {
  logged.length = 0;
  configure({ dryRun: true, person: { country: 'US', state: 'ca' } });
  await processBroker(ctx, { name: 'CA only', method: 'manual', states: ['CA'], optOutUrl: 'https://x' });
  assert.equal(logged[0].status, 'manual');
});
test('a person with no state does not get a states-limited broker', async () => {
  logged.length = 0;
  configure({ dryRun: true, person: { country: 'US' } });
  await processBroker(ctx, { name: 'CA only', method: 'manual', states: ['CA'], optOutUrl: 'https://x' });
  assert.equal(logged.length, 0);
});
```

(Use the names that file already uses for its logger capture and context stub.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement**

`lib/broker-runner.js`, right after the usOnly check:

```js
  // State-specific programmes (California DROP) apply only to residents; say
  // nothing for everyone else so they do not land in "Action Required".
  if (Array.isArray(broker.states) && !broker.states.includes(String(person?.state || '').toUpperCase())) {
    return;
  }
```

`brokers.js`: delete both California entries and add at the top of the list:

```js
  // ═══ California residents only ═══
  {
    name: 'California DROP',
    method: 'manual',
    optOutUrl: 'https://privacy.ca.gov/drop/',
    states: ['CA'],
    priority: 1,
    notes: 'California DROP: one request reaches every data broker registered in California. Submit once at https://privacy.ca.gov/drop/',
  },
```

`git rm test/brokers-ca-delete.test.js test/brokers-caldrop.test.js`.

- [ ] **Step 4: Run** `npm test` — pass, except `docs-commands` README count (fixed in Task 7; run that test last).

- [ ] **Step 5: Commit** `git commit -am "feat(brokers): California DROP only for California residents"` (include the new and removed test files with `git add -A test brokers.js lib/broker-runner.js`).

---

### Task 6: Correct the broker list from the live survey

**Files:**
- Modify: `brokers.js`
- Test: `test/brokers-survey-2026-10.test.js`

- [ ] **Step 1: Failing test**

```js
// test/brokers-survey-2026-10.test.js (config.example.json shim as in the California test)
const REMOVED = ['Radaris', 'PeekYou', 'Nuwber', 'PublicDataUSA', 'ClustrMaps', 'PeopleSmart', 'AnyWho', 'Oracle Data Cloud', 'Intelius', 'TruthFinder', 'InstantCheckmate', 'Equifax (marketing)', 'Experian (marketing)'];
const MANUAL = {
  'PeopleConnect Suppression Center': 'https://suppression.peopleconnect.us/login',
  'OptOutPrescreen (credit bureaus)': 'https://www.optoutprescreen.com/',
  ZoomInfo: 'https://www.zoominfo.com/trust-center/your-privacy',
  Epsilon: 'https://legal.epsilon.com/dsr',
  Acxiom: 'https://www.acxiom.com/optout/',
  LexisNexis: 'https://consumer.risk.lexisnexis.com/opt',
  InfoTracer: 'https://infotracer.com/optout/',
  Clearbit: 'https://clearbit.com/privacy-policy',
  'Addresses.com': 'https://www.addresses.com/',
};
const REPAIRED = {
  FastPeopleSearch: ['#firstname', '#lastname', '#email'],
  USPhonebook: ['#subject-firstname', '#subject-lastname', '#subject-email'],
  PeopleSearchNow: ['#subject-firstname', '#subject-lastname', '#subject-email'],
  SearchPeopleFree: ['#o_first', '#o_last', '#o_email'],
  SocialCatfish: ['#first-name', '#last-name', '#email'],
  PrivateRecords: ['#oo-email'],
};

for (const n of REMOVED) test(`${n} is removed`, () => assert.equal(brokers.find(b => b.name === n), undefined));
for (const [n, url] of Object.entries(MANUAL)) test(`${n} is manual with the live link`, () => {
  const b = brokers.find(x => x.name === n);
  assert.ok(b, n); assert.equal(b.method, 'manual'); assert.equal(b.optOutUrl, url);
  assert.ok((b.notes || '').includes(url), 'notes carry the link so it shows in Action Required');
});
for (const [n, sels] of Object.entries(REPAIRED)) test(`${n} uses the surveyed selectors`, () => {
  const keys = Object.keys(brokers.find(b => b.name === n).formFields);
  for (const s of sels) assert.ok(keys.includes(s), `${n} formFields has ${s}`);
});
test('SocialCatfish never ticks the promotional consent box or the newsletter email', () => {
  const keys = Object.keys(brokers.find(b => b.name === 'SocialCatfish').formFields).join(' ');
  assert.doesNotMatch(keys, /consent|newsletter|name\*=|name="email"/);
});
test('CAPTCHA brokers from the survey ask CapSolver first', () => {
  for (const n of ['FastPeopleSearch', 'USPhonebook', 'PeopleSearchNow', 'SearchPeopleFree', 'SocialCatfish']) {
    assert.equal(brokers.find(b => b.name === n).captchaLikely, true, n);
  }
});
```

- [ ] **Step 2: Run** `node --test test/brokers-survey-2026-10.test.js` — FAIL.

- [ ] **Step 3: Implement in `brokers.js`** (values via the existing `F`, `L`, `E`, `ST` variables; never literal personal data):

```js
  FastPeopleSearch:  formFields: { '#firstname': F, '#lastname': L, '#email': E, 'input[name="legal"]': 'on' }, submitSelector: 'form button[type="submit"]', captchaLikely: true
  USPhonebook:       method: 'direct-form', optOutUrl: 'https://www.usphonebook.com/removal',
                     formFields: { '#subject-firstname': F, '#subject-lastname': L, '#subject-email': E, '#agreement': 'on' },
                     submitSelector: 'button:has-text("Begin Removal Process")', captchaLikely: true
  PeopleSearchNow:   optOutUrl: 'https://www.peoplesearchnow.com/opt-out', same formFields and submitSelector as USPhonebook, captchaLikely: true
  SearchPeopleFree:  formFields: { '#o_first': F, '#o_last': L, '#o_email': E, '#o_terms': 'on' },
                     submitSelector: 'button:has-text("Begin removal process")', captchaLikely: true
  SocialCatfish:     optOutUrl: 'https://socialcatfish.com/opt-out/?id=request_optout',
                     formFields: { '#first-name': F, '#last-name': L, '#email': E },
                     submitSelector: 'button:has-text("Submit Now")', captchaLikely: true
  PrivateRecords:    formFields: { '#r-removal': 'on', '#oo-email': E }
  DataAxle:          formFields: { 'form input[name="email"]': E }
```

(Edit each existing entry in place; keep its other keys such as `priority`, `usOnly`, `expectedSender`.)

Delete the entries in `REMOVED`. Replace Intelius/TruthFinder/InstantCheckmate with:

```js
  {
    name: 'PeopleConnect Suppression Center',
    method: 'manual',
    optOutUrl: 'https://suppression.peopleconnect.us/login',
    priority: 1,
    usOnly: true,
    notes: 'Intelius, TruthFinder and Instant Checkmate: sign in with your alias at https://suppression.peopleconnect.us/login, enter the emailed code, then suppress each record.',
  },
```

Replace Equifax/Experian (marketing) with:

```js
  {
    name: 'OptOutPrescreen (credit bureaus)',
    method: 'manual',
    optOutUrl: 'https://www.optoutprescreen.com/',
    priority: 2,
    usOnly: true,
    notes: 'Equifax, Experian, TransUnion and Innovis prescreened offers: opt out for 5 years online at https://www.optoutprescreen.com/ (permanent needs a signed form).',
  },
```

Turn ZoomInfo, Epsilon, Acxiom, LexisNexis, InfoTracer, Clearbit and Addresses.com into `method: 'manual'` with the `optOutUrl` from `MANUAL`, remove their `formFields`/`submitSelector`/`searchUrl`, and set `notes` to one sentence that includes the URL, e.g. Acxiom: `'The opt-out form is embedded from isapps.acxiom.com and cannot be automated: https://www.acxiom.com/optout/'`; Addresses.com: `'The old opt-out page is gone (404). Look for a privacy or opt-out link at https://www.addresses.com/'`.

- [ ] **Step 4: Run** `npm test` — pass except the README count (Task 7).

- [ ] **Step 5: Commit** `git add brokers.js test/brokers-survey-2026-10.test.js && git commit -m "fix(brokers): apply the 2026-10 live survey"`

---

### Task 7: Survey script, docs and counts

**Files:**
- Create: `scripts/inspect-broker-forms.js` (the read-only survey used above)
- Modify: `README.md:255` (explicit broker count), `STATUS.md` (table and count), `docs/UPEC-MANUAL.md` (what blocked and "form not recognised" mean)
- Test: `test/docs-commands.test.js` already checks the README count; add `test/inspect-broker-forms.test.js`

- [ ] **Step 1: Failing test**

```js
// test/inspect-broker-forms.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'inspect-broker-forms.js'), 'utf8');
test('the survey script uses a dummy person, never the config', () => {
  assert.match(src, /forPerson\(\{ firstName: 'Jane', lastName: 'Doe'/);
  assert.doesNotMatch(src, /loadConfig|config\.json/);
});
test('the survey script never clicks or submits', () => {
  assert.doesNotMatch(src, /\.click\(|\.submit\(|requestSubmit|press\('Enter'\)/);
});
test('the survey script checks Mullvad before visiting anything', () => {
  assert.match(src, /ensureNodeEgress/);
});
```

- [ ] **Step 2: Run** — FAIL (missing file).

- [ ] **Step 3: Implement** `scripts/inspect-broker-forms.js`:

```js
#!/usr/bin/env node
/**
 * scripts/inspect-broker-forms.js - read-only survey of broker opt-out pages.
 *
 * Read-only. Uses a dummy person. Never clicks or submits. For each automated
 * broker it loads the opt-out page and records the visible form controls,
 * CAPTCHA presence and whether the page is a bot-protection/block page, so a
 * drifted definition can be repaired from facts.
 *
 *   node scripts/inspect-broker-forms.js [broker name ...]
 *   HEADED=1 WAIT=20000 node scripts/inspect-broker-forms.js TruePeopleSearch
 *
 * Output: one JSON file per broker in logs/broker-survey/ (gitignored).
 */
'use strict';
process.umask(0o077);
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadChromium } = require(path.join(ROOT, 'lib/playwright-loader'));
const { buildLaunchOptions } = require(path.join(ROOT, 'lib/browser'));
const { buildStealthScript } = require(path.join(ROOT, 'lib/stealth'));
const { ensureNodeEgress } = require(path.join(ROOT, 'lib/egress'));
const { detectBlockPage } = require(path.join(ROOT, 'lib/block-page'));
const brokers = require(path.join(ROOT, 'brokers')).forPerson({ firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', state: 'TX', city: 'Austin', zip: '73301', email: 'jane@example.com', country: 'US' });

const OUT = path.join(ROOT, 'logs', 'broker-survey');
const only = process.argv.slice(2);

function dumpFrame() {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = el => {
    let t = '';
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t = l.innerText; }
    if (!t && el.closest('label')) t = el.closest('label').innerText;
    return (t || '').trim().slice(0, 60);
  };
  const controls = [...document.querySelectorAll('input,select,textarea')].filter(el => el.type !== 'hidden' && vis(el)).map(el => ({
    tag: el.tagName.toLowerCase(), type: el.type, name: el.name, id: el.id,
    placeholder: el.placeholder || '', aria: el.getAttribute('aria-label') || '', label: label(el),
  }));
  const buttons = [...document.querySelectorAll('button,input[type=submit]')].filter(vis)
    .map(b => ({ text: (b.innerText || b.value || '').trim().slice(0, 40), id: b.id, inForm: !!b.closest('form') })).slice(0, 25);
  const captcha = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile');
  const text = document.body ? document.body.innerText.slice(0, 2000) : '';
  return { controls, buttons, captcha, text };
}

(async () => {
  // Same rule as a run: nothing leaves this machine unless it goes out via Mullvad.
  await ensureNodeEgress({ network: { required: true } });
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const chromium = loadChromium();
  const browser = await chromium.launch(buildLaunchOptions({ headless: process.env.HEADED !== '1' }));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(buildStealthScript()).catch(() => {});
  const targets = brokers.filter(b => b.method !== 'manual' && b.method !== 'email' && (!only.length || only.includes(b.name)));
  for (const b of targets) {
    const page = await ctx.newPage();
    const out = { name: b.name, url: b.optOutUrl, formFields: Object.keys(b.formFields || {}), at: new Date().toISOString() };
    try {
      const resp = await page.goto(b.optOutUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      out.status = resp ? resp.status() : null;
      await page.waitForTimeout(Number(process.env.WAIT || 5000));
      out.finalUrl = page.url();
      out.title = await page.title();
      out.main = await page.mainFrame().evaluate(dumpFrame);
      out.frames = [];
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const d = await f.evaluate(dumpFrame).catch(() => null);
        if (d && d.controls.length) out.frames.push({ url: f.url(), ...d });
      }
      out.blocked = detectBlockPage({ status: out.status, title: out.title, text: out.main.text });
      out.main.text = out.main.text.slice(0, 600);
    } catch (e) {
      out.error = String(e.message).split('\n')[0];
    }
    fs.writeFileSync(path.join(OUT, `${b.name.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify(out, null, 1), { mode: 0o600 });
    const n = out.main ? out.main.controls.length : 0;
    console.log(`${b.name.padEnd(26)} ${String(out.status || '-').padEnd(4)} controls=${n} captcha=${!!out.main?.captcha} ${out.blocked || out.error || ''}`);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
```

Docs:
- README count row: set to the new `brokers.length` (run `node -e "console.log(require('./brokers').length)"`), and change "None are currently marked verified" sentence to mention the 2026-10 survey and that bot-protected sites are listed for you to do by hand.
- STATUS.md: regenerate the table from `brokers.js` (name, method, CAPTCHA, confidence = `surveyed 2026-10` for repaired entries, `manual` for manual ones), update "42" to the new count, add a short "Removed in 2026-10" list with the reason for each.
- UPEC-MANUAL.md troubleshooting rows: `blocked by bot protection - open in your normal browser: <link>` → "The site blocks automated browsers or VPN addresses. Open the link yourself; try another Mullvad server if it blocks you too." and `form not recognised ... do it by hand` → "The site changed its form. Open the link and fill it in yourself; report it so the definition can be updated."

- [ ] **Step 4: Run** `npm test` and `cd dashboard && node --test` — all pass.

- [ ] **Step 5: Commit** `git add -A scripts test README.md STATUS.md docs/UPEC-MANUAL.md && git commit -m "docs: broker survey script, counts and troubleshooting"`

---

### Task 8: Live preview check (manual, with the user)

- [ ] Ask the user to run `node bin/aidr.js preview` on Mullvad and paste the summary.
- [ ] Expected: no "Skipped (fresh)", a "Previewed (not submitted)" line, no "Generic runner: undefined", no California items for a non-CA state, bot-walled brokers under "Action Required" with links, no "would submit" line without at least one filled field.
- [ ] Any repaired broker that still shows "not found: …" for its new selectors goes back through Task 6 with a fresh `scripts/inspect-broker-forms.js` run.
