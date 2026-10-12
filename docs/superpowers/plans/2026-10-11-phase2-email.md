# Phase 2 Email Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send Utah privacy requests by email to qualifying data brokers in one confirmed, paced, resumable run, behind its own `--email` flag, from a dedicated mailbox.

**Architecture:** Catalog records gain a review state `email` (address from `survey.contacts`, quoted legal basis). A new pure-ish module `lib/email-step.js` builds the plan, checks the setup and sends with an injected transport, recording each send in `state.json`. `watcher.js` gains `--forms` / `--email` (plain run = forms only), a `SEND` confirmation, `--reply` for logging broker replies, and an email section in `--list`.

**Tech Stack:** Node.js (CommonJS), `node:test`, nodemailer (already an optional dependency), Playwright untouched.

**Spec:** `docs/superpowers/specs/2026-10-11-phase2-email-design.md`

## Global Constraints

- Output is plain text with no emoji.
- The real email, phone, ZIP, date of birth, street address and the forms relay alias never appear in an email body, subject or header.
- Tests never use the member's real name or details; use `config.example.json`-style dummies (Jane Doe, Austin TX) or the names already in tests.
- `email.smtp.user` and `email.smtp.from` must be the same dedicated address.
- Default pacing `email.paceSeconds` = 45; default cap `email.maxPerRun` = 100.
- A plain `aidr run` never sends email. The email step runs only with `--email`.
- `--email` needs an interactive terminal and the member typing exactly `SEND`; `--email --preview` needs neither and opens no SMTP connection.
- SMTP goes out only after `ensureNodeEgress(config)` (Mullvad gate).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A broker address with different case in `review.to` than in `survey.contacts` (`Privacy@X.com`) should validate; covered in Task 1.
- A person whose state is not Utah (multi-person config) must not get a letter claiming Utah residency; covered in Task 2.
- A run killed between the `unknown` write and the send result must, on rerun, ask instead of silently skipping or resending; covered in Task 3 and Task 4.
- An SMTP error message can echo the recipient or the body; logs must carry only the response code; covered in Task 3.
- `aidr reply` with a name matching two brokers (`Data`) must refuse and list them rather than log the wrong one; covered in Task 5.

---

### Task 1: Catalog review state `email`

**Files:**
- Modify: `lib/catalog.js` (STATES, `validateRecord`, new `validateEmailReview`, new export `catalogEmailTargets`)
- Modify: `test/catalog-files.test.js` (allow `review.to`)
- Test: `test/catalog-email-state.test.js` (new)

**Interfaces:**
- Produces: `validateRecord(record, fileName)` accepts `review.state === 'email'`.
- Produces: `catalogEmailTargets(records, { explicitNames = new Set() } = {}) -> Array<{ name: string, domain: string, to: string, basis: { kind: 'utah'|'all-us', quote: string, url: string } }>`; `name` is the run name (`displayName`, with ` (domain)` appended when it collides with an explicit broker name or another target).

- [ ] **Step 1: Write the failing test**

Create `test/catalog-email-state.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRecord, catalogEmailTargets } = require('../lib/catalog');

const rec = (review, extra = {}) => ({
  domain: 'example-broker.com', name: 'Example Broker, Inc.', group: 'business', formHosts: [],
  survey: { contacts: ['privacy@example-broker.com'] },
  review, ...extra,
});
const good = () => ({
  state: 'email', reviewedAt: '2026-10-12', to: 'privacy@example-broker.com',
  basis: { kind: 'utah', quote: 'Residents of Colorado, Utah and Virginia have these rights.', url: 'https://www.example-broker.com/privacy' },
});

test('a valid email record validates', () => {
  assert.equal(validateRecord(rec(good())), null);
});

test('to is matched against survey.contacts case-insensitively', () => {
  assert.equal(validateRecord(rec({ ...good(), to: 'Privacy@Example-Broker.com' })), null);
});

test('to must come from survey.contacts', () => {
  assert.match(validateRecord(rec({ ...good(), to: 'someone@example-broker.com' })), /survey\.contacts/);
});

test('basis.kind must be utah or all-us', () => {
  const r = good(); r.basis.kind = 'california';
  assert.match(validateRecord(rec(r)), /basis\.kind/);
});

test('basis.quote must be non-empty, at most 400 chars, with no address', () => {
  const a = good(); a.basis.quote = '';
  assert.match(validateRecord(rec(a)), /basis\.quote/);
  const b = good(); b.basis.quote = 'x'.repeat(401);
  assert.match(validateRecord(rec(b)), /basis\.quote/);
  const c = good(); c.basis.quote = 'Write to privacy@example-broker.com for help.';
  assert.match(validateRecord(rec(c)), /email address/);
});

test('basis.url must be https on the domain or a form host', () => {
  const a = good(); a.basis.url = 'http://www.example-broker.com/privacy';
  assert.match(validateRecord(rec(a)), /https/);
  const b = good(); b.basis.url = 'https://elsewhere.com/privacy';
  assert.match(validateRecord(rec(b)), /not on example-broker\.com/);
  const c = good(); c.basis.url = 'https://privacyportal.onetrust.com/x';
  assert.equal(validateRecord(rec(c, { formHosts: ['onetrust.com'] })), null);
});

test('catalogEmailTargets lists email records with run names', () => {
  const other = rec({ state: 'manual', optOutUrl: 'https://www.example-broker.com/x' }, { domain: 'other.com', name: 'Other LLC' });
  const t = catalogEmailTargets([rec(good()), other]);
  assert.deepEqual(t, [{ name: 'Example Broker', domain: 'example-broker.com', to: 'privacy@example-broker.com', basis: good().basis }]);
});

test('catalogEmailTargets appends the domain when a name collides', () => {
  const t = catalogEmailTargets([rec(good())], { explicitNames: new Set(['example broker']) });
  assert.equal(t[0].name, 'Example Broker (example-broker.com)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/catalog-email-state.test.js`
Expected: FAIL (`unknown review state "email"`, `catalogEmailTargets is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `lib/catalog.js`:

Change the states line to:

```js
const STATES = ['unreviewed', 'reviewed', 'manual', 'needs-review', 'excluded', 'email'];
```

Add after `validateDefinition`:

```js
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
```

In `validateRecord`, after the `reviewed` line:

```js
  if (review.state === 'email') return validateEmailReview(record, review);
```

Add before `module.exports`:

```js
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
```

Add `catalogEmailTargets` to `module.exports`.

In `test/catalog-files.test.js`, inside the personal-values test, replace the `text` line with:

```js
    // review.to is an address by design; validateRecord pins it to survey.contacts.
    const review = rec.review && rec.review.state === 'email' ? { ...rec.review, to: '' } : rec.review;
    const text = JSON.stringify({ ...rec, survey: { ...(rec.survey || {}), contacts: [] }, review });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/catalog-email-state.test.js test/catalog-files.test.js test/catalog.test.js`
Expected: PASS (if `test/catalog.test.js` does not exist, drop it from the command).

- [ ] **Step 5: Commit**

```bash
git add lib/catalog.js test/catalog-email-state.test.js test/catalog-files.test.js
git commit -m "feat(catalog): review state email with a quoted legal basis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The Utah request template

**Files:**
- Modify: `lib/email.js` (new `buildUcpaRequest`, export it)
- Test: `test/email-ucpa-template.test.js` (new)

**Interfaces:**
- Produces: `buildUcpaRequest(person, contact) -> { subject: string, body: string }`. `contact` is the dedicated sender address.

- [ ] **Step 1: Write the failing test**

Create `test/email-ucpa-template.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildUcpaRequest } = require('../lib/email');
const example = require('../config.example.json');

const P = example.person;
const UT = { ...P, city: 'Provo', state: 'UT', dob: '1980-03-15' };
const CONTACT = 'requests.only@example.net';

test('subject and the three requests', () => {
  const { subject, body } = buildUcpaRequest(UT, CONTACT);
  assert.equal(subject, 'Privacy request: opt out of sale and targeted advertising, and delete');
  assert.match(body, /Utah Consumer Privacy Act/);
  assert.match(body, /stop selling or sharing my personal data/);
  assert.match(body, /targeted advertising/);
  assert.match(body, /delete my personal data/);
});

test('identifies by name, city and state, contact is the dedicated address', () => {
  const { body } = buildUcpaRequest(UT, CONTACT);
  assert.ok(body.includes(`Name: ${UT.fullName}`));
  assert.ok(body.includes('Location: Provo, Utah'));
  assert.ok(body.includes(CONTACT));
});

test('never carries email, phone, zip, date of birth or a relay alias', () => {
  const { subject, body } = buildUcpaRequest({ ...UT, relayAlias: 'alias123@simplelogin.com' }, CONTACT);
  const text = subject + '\n' + body;
  for (const v of [P.email, P.phone, P.phoneFormatted, P.zip, '1980', 'simplelogin']) {
    assert.ok(!text.includes(v), `leaked ${v}`);
  }
});

test('a person outside Utah gets no Utah residency claim', () => {
  const { body } = buildUcpaRequest(P, CONTACT); // Austin, TX
  assert.ok(!/I am a Utah resident/.test(body));
  assert.match(body, /Texas/);
  assert.match(body, /privacy law that applies/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/email-ucpa-template.test.js`
Expected: FAIL (`buildUcpaRequest is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `lib/email.js`, add near the other requires:

```js
const { normalizeUsState, usStateName } = require('./us-state');
```

Add after `_buildBodyCCPA`:

```js
const UCPA_SUBJECT = 'Privacy request: opt out of sale and targeted advertising, and delete';

/**
 * Phase 2 request letter (docs/superpowers/specs/2026-10-11-phase2-email-design.md).
 * Identifies the person by name, city and state only. `contact` is the
 * dedicated sending mailbox; nothing else about the person goes in.
 * @param {object} person
 * @param {string} contact
 * @returns {{ subject: string, body: string }}
 */
function buildUcpaRequest(person, contact) {
  const name = person.fullName || [person.firstName, person.lastName].filter(Boolean).join(' ');
  const stateName = usStateName(person.state) || String(person.state || '');
  const opening = normalizeUsState(person.state) === 'UT'
    ? 'I am a Utah resident. Under the Utah Consumer Privacy Act (Utah Code Title 13, Chapter 61) and any other privacy law that applies, I ask you to:'
    : `I live in ${stateName}. Under the privacy law that applies to me, I ask you to:`;
  const body = [
    'To the privacy team,',
    '',
    opening,
    '',
    '1. stop selling or sharing my personal data;',
    '2. stop processing my personal data for targeted advertising; and',
    '3. delete my personal data.',
    '',
    'Details to locate my records:',
    `Name: ${name}`,
    `Location: ${[person.city, stateName].filter(Boolean).join(', ')}`,
    '',
    `Please confirm when this is done by replying to ${contact}.`,
    '',
    'Thank you,',
    name,
  ].join('\n');
  return { subject: UCPA_SUBJECT, body };
}
```

Add `buildUcpaRequest` to `module.exports` (above the internal exports).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/email-ucpa-template.test.js test/email.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/email.js test/email-ucpa-template.test.js
git commit -m "feat(email): Utah privacy request template

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/email-step.js` - setup check, plan and paced sender

**Files:**
- Create: `lib/email-step.js`
- Test: `test/email-step.test.js` (new)

**Interfaces:**
- Consumes: `buildUcpaRequest(person, contact)` (Task 2); `catalogEmailTargets` output shape (Task 1); `stateKey(name, person, total)` from `lib/config`; `smtpFromLeakReason(smtp, person)` from `lib/relay`.
- Produces:
  - `checkEmailSetup({ config, persons, isTTY, preview }) -> string|null`
  - `buildEmailPlan({ targets, brokers, persons, state, from, maxPerRun }) -> { items: Item[], unknown: Item[], manual: Item[] }` where `Item = { key, name, to, basis|null, subject, body }`
  - `sendEmailPlan(items, { transport, from, paceMs, sleep, state, save, log, now }) -> Promise<{ sent: Item[], failed: Array<Item & { code }>, stopped: null|'auth'|'quota' }>`
  - `classifySmtpError(err) -> 'auth'|'quota'|'broker'`
  - `markUnknownAsSent(state, item, now)`
  - `REPLY_OUTCOMES = ['honored','refused','verify','none','bounced']`
  - `recordReply(state, key, outcome, now)`

- [ ] **Step 1: Write the failing test**

Create `test/email-step.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const step = require('../lib/email-step');

const P = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Provo', state: 'UT', email: 'jane.doe@example.com' };
const FROM = 'requests.only@example.net';
const SMTP = { host: 'smtp.example.net', port: 587, user: FROM, pass: 'pw', from: FROM };
const T = (name, to) => ({ name, domain: `${name.toLowerCase()}.com`, to, basis: { kind: 'utah', quote: 'Utah residents.', url: `https://${name.toLowerCase()}.com/p` } });
const NOW = () => '2026-10-12T00:00:00.000Z';

test('setup: refuses without smtp, on a leak, on user != from, and without a TTY', () => {
  assert.match(step.checkEmailSetup({ config: {}, persons: [P], isTTY: true }), /email\.smtp/);
  assert.match(step.checkEmailSetup({ config: { email: { smtp: { ...SMTP, user: P.email, from: P.email } } }, persons: [P], isTTY: true }), /real email/);
  assert.match(step.checkEmailSetup({ config: { email: { smtp: { ...SMTP, from: 'other@example.net' } } }, persons: [P], isTTY: true }), /same dedicated address/);
  assert.match(step.checkEmailSetup({ config: { email: { smtp: SMTP } }, persons: [P], isTTY: false }), /interactive terminal/);
  assert.equal(step.checkEmailSetup({ config: { email: { smtp: SMTP } }, persons: [P], isTTY: false, preview: true }), null);
  assert.equal(step.checkEmailSetup({ config: { email: { smtp: SMTP } }, persons: [P], isTTY: true }), null);
});

test('plan: catalog targets plus email brokers, skipping sent, cap applied', () => {
  const brokers = [{ name: 'Pipl', method: 'email', emailTo: 'privacy@pipl.com' }, { name: 'Form Co', method: 'direct-form' }];
  const state = { optOuts: {}, emailSent: { Beta: { to: 'p@beta.com', at: NOW(), messageId: 'm1' } } };
  const plan = step.buildEmailPlan({ targets: [T('Alpha', 'p@alpha.com'), T('Beta', 'p@beta.com')], brokers, persons: [P], state, from: FROM, maxPerRun: 100 });
  assert.deepEqual(plan.items.map(i => i.name), ['Alpha', 'Pipl']);
  assert.equal(plan.items[0].to, 'p@alpha.com');
  assert.match(plan.items[0].body, /Jane Doe/);
  assert.equal(plan.items[1].basis, null);
  const capped = step.buildEmailPlan({ targets: [T('Alpha', 'a@alpha.com'), T('Gamma', 'g@gamma.com')], brokers: [], persons: [P], state: { optOuts: {} }, from: FROM, maxPerRun: 1 });
  assert.equal(capped.items.length, 1);
});

test('plan: unknown entries are returned separately; two failures or a bounce move to manual', () => {
  const state = {
    optOuts: {},
    emailSent: { Alpha: { to: 'p@alpha.com', at: NOW(), status: 'unknown' } },
    emailFailures: { Beta: 2 },
    emailReplies: { Gamma: { outcome: 'bounced', at: NOW() } },
  };
  const plan = step.buildEmailPlan({ targets: [T('Alpha', 'p@alpha.com'), T('Beta', 'p@beta.com'), T('Gamma', 'p@gamma.com')], brokers: [], persons: [P], state, from: FROM, maxPerRun: 100 });
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.unknown.map(i => i.name), ['Alpha']);
  assert.deepEqual(plan.manual.map(i => i.name), ['Beta', 'Gamma']);
});

test('plan: multi-person keys carry the person', () => {
  const Q = { ...P, firstName: 'John', fullName: 'John Doe' };
  const plan = step.buildEmailPlan({ targets: [T('Alpha', 'p@alpha.com')], brokers: [], persons: [P, Q], state: { optOuts: {} }, from: FROM, maxPerRun: 100 });
  assert.deepEqual(plan.items.map(i => i.key), ['Alpha|Jane Doe', 'Alpha|John Doe']);
});

function harness(behaviour) {
  const sent = []; const sleeps = []; const lines = []; let saves = 0;
  const state = { optOuts: {} };
  const transport = { sendMail: async (m) => { const r = behaviour(m); if (r instanceof Error) throw r; sent.push(m); return { messageId: `id-${sent.length}` }; } };
  const opts = { transport, from: FROM, paceMs: 45000, sleep: async ms => sleeps.push(ms), state, save: () => { saves++; }, log: l => lines.push(l), now: NOW };
  return { sent, sleeps, lines, state, opts, saves: () => saves };
}
const items = () => ['Alpha', 'Beta', 'Gamma'].map(n => ({ key: n, name: n, to: `p@${n.toLowerCase()}.com`, basis: null, subject: 'S', body: 'B' }));

test('send: paced, recorded per send, from and replyTo are the dedicated address', async () => {
  const h = harness(() => null);
  const r = await step.sendEmailPlan(items(), h.opts);
  assert.equal(r.sent.length, 3);
  assert.deepEqual(h.sleeps, [45000, 45000]);
  assert.equal(h.sent[0].from, FROM);
  assert.equal(h.sent[0].replyTo, FROM);
  assert.deepEqual(h.state.emailSent.Beta, { to: 'p@beta.com', at: NOW(), messageId: 'id-2' });
  assert.ok(h.saves() >= 6); // unknown marker and result, per send
});

test('send: an auth error stops the run and records nothing for that broker', async () => {
  const h = harness(() => Object.assign(new Error('Invalid login: 535 Username and Password not accepted for p@x.com'), { code: 'EAUTH', responseCode: 535 }));
  const r = await step.sendEmailPlan(items(), h.opts);
  assert.equal(r.stopped, 'auth');
  assert.equal(r.sent.length, 0);
  assert.equal((h.state.emailSent || {}).Alpha, undefined);
});

test('send: a quota error stops; what was sent stays recorded', async () => {
  let n = 0;
  const h = harness(() => (++n === 2 ? Object.assign(new Error('Daily user sending limit exceeded'), { responseCode: 550 }) : null));
  const r = await step.sendEmailPlan(items(), h.opts);
  assert.equal(r.stopped, 'quota');
  assert.deepEqual(Object.keys(h.state.emailSent), ['Alpha']);
});

test('send: a per-broker rejection continues, counts the failure, logs only the code', async () => {
  const h = harness(m => (m.to === 'p@beta.com' ? Object.assign(new Error('550 5.1.1 p@beta.com does not exist: B'), { responseCode: 550 }) : null));
  const r = await step.sendEmailPlan(items(), h.opts);
  assert.equal(r.sent.length, 2);
  assert.equal(r.failed[0].code, 550);
  assert.equal(h.state.emailFailures.Beta, 1);
  assert.equal(h.state.emailSent.Beta, undefined);
  assert.ok(!h.lines.join('\n').includes('does not exist'));
});

test('send: an interruption leaves the in-flight broker unknown', async () => {
  const h = harness(m => { if (m.to === 'p@beta.com') throw Object.assign(new Error('killed'), { fatal: true }); return null; });
  await assert.rejects(step.sendEmailPlan(items(), h.opts), /killed/);
  assert.equal(h.state.emailSent.Beta.status, 'unknown');
  assert.equal(h.state.emailSent.Alpha.messageId, 'id-1');
});

test('markUnknownAsSent and recordReply', () => {
  const state = { optOuts: {}, emailSent: { A: { to: 'p@a.com', at: NOW(), status: 'unknown' } } };
  step.markUnknownAsSent(state, { key: 'A', to: 'p@a.com' }, NOW);
  assert.deepEqual(state.emailSent.A, { to: 'p@a.com', at: NOW(), messageId: null, assumed: true });
  step.recordReply(state, 'A', 'honored', NOW);
  assert.deepEqual(state.emailReplies.A, { outcome: 'honored', at: NOW() });
  assert.throws(() => step.recordReply(state, 'A', 'maybe', NOW), /outcome/);
});

test('classifySmtpError', () => {
  assert.equal(step.classifySmtpError({ code: 'EAUTH' }), 'auth');
  assert.equal(step.classifySmtpError({ responseCode: 421, message: 'try later' }), 'quota');
  assert.equal(step.classifySmtpError({ responseCode: 550, message: 'Daily user sending limit exceeded' }), 'quota');
  assert.equal(step.classifySmtpError({ responseCode: 550, message: 'no such user' }), 'broker');
});
```

Note on the interruption test: a transport error with `fatal: true` stands in for the process dying mid-send; `sendEmailPlan` rethrows errors flagged `fatal` without touching the `unknown` marker.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/email-step.test.js`
Expected: FAIL (`Cannot find module '../lib/email-step'`).

- [ ] **Step 3: Write minimal implementation**

Create `lib/email-step.js`:

```js
'use strict';
/**
 * lib/email-step.js
 *
 * Phase 2: privacy requests by email (docs/superpowers/specs/
 * 2026-10-11-phase2-email-design.md). Builds the plan, checks the setup and
 * sends one email at a time through an injected transport, recording each
 * send in state as it happens. No network here: the caller supplies the
 * transport and passes the egress gate first.
 */
const { stateKey } = require('./config');
const { smtpFromLeakReason } = require('./relay');
const { buildUcpaRequest } = require('./email');

const REPLY_OUTCOMES = ['honored', 'refused', 'verify', 'none', 'bounced'];
const lower = (s) => String(s || '').trim().toLowerCase();

function checkEmailSetup({ config, persons, isTTY, preview }) {
  const smtp = config && config.email && config.email.smtp;
  if (!smtp || !smtp.host || !smtp.user || !smtp.pass) return 'add an email.smtp block (host, port, user, pass, from) to config.json';
  for (const person of persons || []) {
    const leak = smtpFromLeakReason(smtp, person);
    if (leak) return leak;
  }
  if (lower(smtp.user) !== lower(smtp.from)) return 'email.smtp.user and email.smtp.from must be the same dedicated address';
  if (!preview && !isTTY) return 'the email step needs an interactive terminal to confirm with SEND';
  return null;
}

function buildEmailPlan({ targets, brokers, persons, state, from, maxPerRun }) {
  const sent = (state && state.emailSent) || {};
  const failures = (state && state.emailFailures) || {};
  const replies = (state && state.emailReplies) || {};
  const all = [
    ...(targets || []).map(t => ({ name: t.name, to: t.to, basis: t.basis })),
    ...(brokers || []).filter(b => b.method === 'email' && b.emailTo).map(b => ({ name: b.name, to: lower(b.emailTo), basis: null })),
  ];
  const plan = { items: [], unknown: [], manual: [] };
  for (const person of persons || []) {
    const { subject, body } = buildUcpaRequest(person, from);
    for (const t of all) {
      const key = stateKey(t.name, person, persons.length);
      const item = { key, name: t.name, to: t.to, basis: t.basis, subject, body };
      const s = sent[key];
      if (s && s.status === 'unknown') { plan.unknown.push(item); continue; }
      if (s) continue;
      if ((failures[key] || 0) >= 2 || (replies[key] && replies[key].outcome === 'bounced')) { plan.manual.push(item); continue; }
      plan.items.push(item);
    }
  }
  plan.items = plan.items.slice(0, maxPerRun);
  return plan;
}

function classifySmtpError(err) {
  const code = err && err.responseCode;
  const msg = String((err && err.message) || '');
  if ((err && err.code === 'EAUTH') || code === 534 || code === 535) return 'auth';
  if (code === 421 || code === 452 || /daily user sending limit|quota|rate limit|too many/i.test(msg)) return 'quota';
  return 'broker';
}

async function sendEmailPlan(items, { transport, from, paceMs = 45000, sleep, state, save, log = () => {}, now = () => new Date().toISOString() }) {
  state.emailSent = state.emailSent || {};
  state.emailFailures = state.emailFailures || {};
  const result = { sent: [], failed: [], stopped: null };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (i > 0) await sleep(paceMs);
    // Written before the send: a run that dies here leaves "unknown", and the
    // next run asks instead of guessing.
    state.emailSent[it.key] = { to: it.to, at: now(), status: 'unknown' };
    save();
    let info;
    try {
      info = await transport.sendMail({ from, to: it.to, replyTo: from, subject: it.subject, text: it.body });
    } catch (err) {
      if (err && err.fatal) throw err;
      delete state.emailSent[it.key];
      const kind = classifySmtpError(err);
      const code = (err && (err.responseCode || err.code)) || 'error';
      if (kind !== 'broker') {
        save();
        result.stopped = kind;
        log(`  stopped at ${it.name}: ${kind === 'auth' ? 'the mailbox refused the login' : 'the mailbox sending limit was reached'} (${code})`);
        break;
      }
      state.emailFailures[it.key] = (state.emailFailures[it.key] || 0) + 1;
      save();
      result.failed.push({ ...it, code });
      log(`  error ${it.name}: not delivered (${code})`);
      continue;
    }
    state.emailSent[it.key] = { to: it.to, at: now(), messageId: (info && info.messageId) || null };
    save();
    result.sent.push(it);
    log(`  sent  ${it.name} -> ${it.to}`);
  }
  return result;
}

function markUnknownAsSent(state, item, now = () => new Date().toISOString()) {
  state.emailSent = state.emailSent || {};
  state.emailSent[item.key] = { to: item.to, at: now(), messageId: null, assumed: true };
}

function recordReply(state, key, outcome, now = () => new Date().toISOString()) {
  if (!REPLY_OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of: ${REPLY_OUTCOMES.join(', ')}`);
  state.emailReplies = state.emailReplies || {};
  state.emailReplies[key] = { outcome, at: now() };
}

module.exports = { checkEmailSetup, buildEmailPlan, sendEmailPlan, classifySmtpError, markUnknownAsSent, recordReply, REPLY_OUTCOMES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/email-step.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add lib/email-step.js test/email-step.test.js
git commit -m "feat(email): email step plan, setup check and paced sender

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `runEmailStep` and the `--forms` / `--email` flags

**Files:**
- Modify: `lib/email-step.js` (add `runEmailStep`)
- Modify: `watcher.js` (flags, call site, remove the in-run `sendOptOutEmails` block)
- Modify: `lib/cli-map.js` (help text for `run`)
- Modify: `config.example.json` (`email.paceSeconds`, `email.maxPerRun`)
- Test: `test/email-run-step.test.js` (new), `test/watcher-email-flags.test.js` (new)

**Interfaces:**
- Consumes: Task 3 exports; `catalogEmailTargets` (Task 1).
- Produces: `runEmailStep({ config, persons, state, save, targets, brokers, preview, isTTY, ask, log, makeTransport, ensureEgress, sleep }) -> Promise<number>` (exit code: 0 ok or nothing to do, 1 refused/stopped/aborted).

- [ ] **Step 1: Write the failing tests**

Create `test/email-run-step.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runEmailStep } = require('../lib/email-step');

const P = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Provo', state: 'UT', email: 'jane.doe@example.com' };
const FROM = 'requests.only@example.net';
const config = { email: { smtp: { host: 'h', port: 587, user: FROM, pass: 'pw', from: FROM }, paceSeconds: 1, maxPerRun: 100 } };
const targets = [{ name: 'Alpha', domain: 'alpha.com', to: 'p@alpha.com', basis: { kind: 'utah', quote: 'Utah residents.', url: 'https://alpha.com/p' } }];

function deps(over = {}) {
  const out = { lines: [], sent: [], egress: 0, transports: 0 };
  const d = {
    config, persons: [P], state: { optOuts: {} }, save: () => {}, targets, brokers: [],
    preview: false, isTTY: true, ask: async () => 'SEND', log: l => out.lines.push(l),
    makeTransport: () => { out.transports++; return { sendMail: async m => { out.sent.push(m); return { messageId: 'x' }; } }; },
    ensureEgress: async () => { out.egress++; }, sleep: async () => {},
    ...over,
  };
  return { d, out };
}

test('SEND sends after the egress gate', async () => {
  const { d, out } = deps();
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.egress, 1);
  assert.equal(out.sent.length, 1);
  assert.match(out.lines.join('\n'), /Utah residents\./);
});

test('anything but SEND aborts with nothing sent', async () => {
  const { d, out } = deps({ ask: async () => 'send' });
  assert.equal(await runEmailStep(d), 1);
  assert.equal(out.sent.length, 0);
  assert.equal(out.transports, 0);
});

test('preview prints every body and opens no transport', async () => {
  const { d, out } = deps({ preview: true, isTTY: false, ask: async () => { throw new Error('no prompt in preview'); } });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.transports, 0);
  assert.equal(out.egress, 0);
  assert.match(out.lines.join('\n'), /stop selling or sharing my personal data/);
});

test('a failed setup check refuses before anything else', async () => {
  const { d, out } = deps({ isTTY: false });
  assert.equal(await runEmailStep(d), 1);
  assert.match(out.lines.join('\n'), /interactive terminal/);
  assert.equal(out.transports, 0);
});

test('an unknown entry is asked about: n marks it sent, y resends it', async () => {
  const state = { optOuts: {}, emailSent: { Alpha: { to: 'p@alpha.com', at: 't', status: 'unknown' } } };
  const a = deps({ state, ask: async q => (/Resend/.test(q) ? 'n' : 'SEND') });
  assert.equal(await runEmailStep(a.d), 0);
  assert.equal(a.out.sent.length, 0);
  assert.equal(state.emailSent.Alpha.assumed, true);

  const state2 = { optOuts: {}, emailSent: { Alpha: { to: 'p@alpha.com', at: 't', status: 'unknown' } } };
  const b = deps({ state: state2, ask: async q => (/Resend/.test(q) ? 'y' : 'SEND') });
  assert.equal(await runEmailStep(b.d), 0);
  assert.equal(b.out.sent.length, 1);
});

test('nothing pending is a clean no-op', async () => {
  const { d, out } = deps({ targets: [] });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.transports, 0);
  assert.match(out.lines.join('\n'), /No email requests pending/);
});
```

Create `test/watcher-email-flags.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'watcher.js'), 'utf8');

test('the email step runs only under --email', () => {
  assert.match(src, /const EMAIL\s+= process\.argv\.includes\('--email'\)/);
  assert.match(src, /const FORMS\s+= process\.argv\.includes\('--forms'\) \|\| !EMAIL/);
  const calls = src.match(/runEmailStep\(/g) || [];
  assert.equal(calls.length, 1);
  assert.match(src, /if \(EMAIL\) \{[\s\S]{0,1500}runEmailStep\(\{/);
});

test('the forms run no longer sends email', () => {
  assert.ok(!/sendOptOutEmails\(/.test(src), 'sendOptOutEmails must not be called from watcher.js');
});

test('--email alone returns before the browser opens', () => {
  assert.match(src, /if \(!FORMS\) return;/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/email-run-step.test.js test/watcher-email-flags.test.js`
Expected: FAIL (`runEmailStep is not a function`; watcher regexes do not match).

- [ ] **Step 3: Implement `runEmailStep`**

Append to `lib/email-step.js` (before `module.exports`) and add `runEmailStep` to the exports:

```js
async function runEmailStep({ config, persons, state, save, targets, brokers, preview, isTTY, ask, log, makeTransport, ensureEgress, sleep }) {
  log('\n-- Email requests ------------------------------------------');
  const problem = checkEmailSetup({ config, persons, isTTY, preview });
  if (problem) { log(`Email step not run: ${problem}.`); return 1; }
  const emailCfg = config.email || {};
  const from = emailCfg.smtp.from;
  const paceMs = Math.max(1, Number(emailCfg.paceSeconds) || 45) * 1000;
  const maxPerRun = Math.max(1, Number(emailCfg.maxPerRun) || 100);
  const plan = buildEmailPlan({ targets, brokers, persons, state, from, maxPerRun });

  for (const m of plan.manual) log(`  manual ${m.name}: email to ${m.to} failed or bounced - check the address and send by hand`);

  // Interrupted sends from an earlier run: ask, never guess.
  if (!preview) {
    for (const u of plan.unknown) {
      const a = String(await ask(`  ${u.name} (${u.to}) may or may not have been sent last time. Resend? [y/N] `)).trim().toLowerCase();
      if (a === 'y' || a === 'yes') plan.items.push(u);
      else markUnknownAsSent(state, u);
    }
    if (plan.unknown.length) save();
  }

  if (!plan.items.length) { log('No email requests pending.'); return 0; }

  log(`${plan.items.length} email request(s) from ${from}:`);
  for (const it of plan.items) {
    log(`  ${it.name.padEnd(40)} ${it.to}`);
    if (it.basis) log(`      basis (${it.basis.kind}): "${it.basis.quote}"  ${it.basis.url}`);
  }
  log(`\nSubject: ${plan.items[0].subject}\n\n${plan.items[0].body}\n`);
  if (preview) {
    for (const it of plan.items.slice(1)) log(`--- ${it.name} ---\n${it.body}\n`);
    log('Preview: nothing sent.');
    return 0;
  }

  const minutes = Math.ceil(((plan.items.length - 1) * paceMs) / 60000);
  const answer = String(await ask(`Type SEND to send ${plan.items.length} email(s), one every ${paceMs / 1000}s (about ${minutes} min): `)).trim();
  if (answer !== 'SEND') { log('Not sent.'); return 1; }

  await ensureEgress(config);
  const result = await sendEmailPlan(plan.items, { transport: makeTransport(emailCfg.smtp), from, paceMs, sleep, state, save, log });
  log(`\nEmail requests: ${result.sent.length} sent, ${result.failed.length} not delivered.`);
  if (result.stopped === 'auth') log('Stopped: the mailbox refused the login. Check email.smtp.user and the app password (2-step verification must be on).');
  if (result.stopped === 'quota') log('Stopped: the mailbox hit its sending limit. Run --email again tomorrow; it carries on where it stopped.');
  return result.stopped ? 1 : 0;
}
```

- [ ] **Step 4: Wire it into `watcher.js`**

4a. Next to `const PREVIEW = ...` add:

```js
// Phase 2: --email sends the email requests, --forms fills web forms. A plain
// run is --forms only, so a scheduled run can never send email.
const EMAIL             = process.argv.includes('--email');
const FORMS             = process.argv.includes('--forms') || !EMAIL;
```

4b. At the very start of `_mainBody()`, after the `catalogRecords` / `explicitCatalogOpts` lines and before `const { runGenericBrokers } = ...`, insert:

```js
  if (EMAIL) {
    const { runEmailStep } = require('./lib/email-step');
    const { catalogEmailTargets } = require('./lib/catalog');
    const nodemailer = require('nodemailer');
    const { smtpTransportOptions } = require('./lib/email');
    const askLine = (q) => new Promise(resolve => {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      rl.question(q, a => { rl.close(); resolve(a); });
    });
    const code = await runEmailStep({
      config, persons, state, save: saveState,
      targets: catalogEmailTargets(catalogRecords, { explicitNames: explicitCatalogOpts.explicitNames }),
      brokers, preview: DRY_RUN, isTTY: !!process.stdin.isTTY, ask: askLine, log: (l) => console.log(l),
      makeTransport: (smtp) => nodemailer.createTransport(smtpTransportOptions(smtp)),
      ensureEgress: ensureNodeEgress, sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    });
    if (code) process.exitCode = code;
    if (!FORMS) return;
  }
```

`state` (module-level, `const state = loadState();`) and `saveState` (imported from `./lib/config` on line 18) are already in scope. `ensureNodeEgress` is not: change the egress import near the top from `const { setEgressConfig } = require('./lib/egress');` to `const { setEgressConfig, ensureNodeEgress } = require('./lib/egress');`.

4c. Delete the whole block that starts with the comment `// Email opt-outs (no browser needed - skipped in verify mode).` and ends with its closing `}` (the `if (!VERIFY) { console.log('── Email opt-outs ...'); try { await sendOptOutEmails(...) } ... }` block). Remove `sendOptOutEmails` from the `require('./lib/email')` line at the top if nothing else uses it.

4d. If `VERIFY` and `EMAIL` are both set, refuse early, next to the `--assist` check:

```js
if (process.argv.includes('--email') && process.argv.includes('--verify')) {
  console.error('--email cannot be combined with --verify.');
  process.exit(1);
}
```

4e. In `lib/cli-map.js` change the `run` description to `'Run the opt-out pass now (--forms: web forms, the default; --email: email requests)'`.

4f. In `config.example.json` add inside the `email` block, after `smtp`:

```json
    "paceSeconds": 45,
    "maxPerRun": 100,
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/email-run-step.test.js test/watcher-email-flags.test.js test/cli-map.test.js test/email-plan-wiring.test.js`
Expected: PASS. Then run `npm test`; expected: all pass. If a test asserted that a normal run sends email (search: `grep -rln "Email opt-outs" test/`), update it to pass `--email` or to assert the new rule, and say so in the commit message.

- [ ] **Step 6: Commit**

```bash
git add lib/email-step.js watcher.js lib/cli-map.js config.example.json test/email-run-step.test.js test/watcher-email-flags.test.js
git commit -m "feat(email): --email step with SEND confirmation; plain runs fill forms only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `aidr reply`, `aidr list` email section, dashboard note

**Files:**
- Modify: `watcher.js` (`--reply` mode, `--list` email section)
- Modify: `lib/email-step.js` (add `findEmailTarget`)
- Modify: `lib/cli-map.js` (`reply` command)
- Modify: `dashboard/server.js` (`/api/brokers` note for email records)
- Test: `test/email-reply.test.js` (new), `test/cli-map.test.js` (extend)

**Interfaces:**
- Consumes: `recordReply`, `REPLY_OUTCOMES` (Task 3), `catalogEmailTargets` (Task 1).
- Produces: `findEmailTarget(names: string[], query: string) -> { name } | { error: string }`.

- [ ] **Step 1: Write the failing tests**

Create `test/email-reply.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findEmailTarget } = require('../lib/email-step');

const names = ['Claritas', 'Data Axle', 'DataMasters', 'Wiland'];

test('an exact name wins, case-insensitive', () => {
  assert.deepEqual(findEmailTarget(names, 'claritas'), { name: 'Claritas' });
});

test('a unique substring matches', () => {
  assert.deepEqual(findEmailTarget(names, 'wil'), { name: 'Wiland' });
});

test('an ambiguous query refuses and lists the matches', () => {
  const r = findEmailTarget(names, 'data');
  assert.match(r.error, /Data Axle/);
  assert.match(r.error, /DataMasters/);
});

test('no match refuses', () => {
  assert.match(findEmailTarget(names, 'nobody').error, /No email broker/);
});
```

Append to `test/cli-map.test.js`:

```js
test('reply maps to watcher --reply and passes the arguments through', () => {
  const { resolveCommand } = require('../lib/cli-map');
  const r = resolveCommand(['reply', 'Claritas', 'honored']);
  assert.equal(r.ok, true);
  assert.equal(r.file, 'watcher.js');
  assert.deepEqual(r.args.slice(-3), ['--reply', 'Claritas', 'honored']);
});
```

(`resolveCommand(['list','x'])` returns `{ ok, target, command, file, cwd, args: ['watcher.js','--list','x'] }`, so `file` and `args` are the right properties.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/email-reply.test.js test/cli-map.test.js`
Expected: FAIL (`findEmailTarget is not a function`; unknown command: reply).

- [ ] **Step 3: Implement**

In `lib/email-step.js` add and export:

```js
function findEmailTarget(names, query) {
  const q = lower(query);
  const exact = names.filter(n => lower(n) === q);
  if (exact.length === 1) return { name: exact[0] };
  const hits = names.filter(n => lower(n).includes(q));
  if (hits.length === 1) return { name: hits[0] };
  if (!hits.length) return { error: `No email broker matches "${query}".` };
  return { error: `"${query}" matches more than one email broker: ${hits.join(', ')}. Use the full name.` };
}
```

In `lib/cli-map.js` `COMMANDS`, after `list`:

```js
  reply:            { file: 'watcher.js',          flags: ['--reply'],          cwd: 'root',      desc: 'Log a broker reply to an email request: aidr reply <broker> honored|refused|verify|none|bounced' },
```

In `watcher.js`, directly after the `if (LIST_MODE) { ... }` block, add:

```js
// ── --reply <broker> <outcome>: log a reply to an email request, then exit ───
if (process.argv.includes('--reply')) {
  const i = process.argv.indexOf('--reply');
  const query = process.argv[i + 1] || '';
  const outcome = process.argv[i + 2] || '';
  const { recordReply, findEmailTarget, REPLY_OUTCOMES } = require('./lib/email-step');
  const { loadCatalog, catalogEmailTargets } = require('./lib/catalog');
  const brokersList = require('./brokers');
  if (!REPLY_OUTCOMES.includes(outcome)) {
    console.error(`Usage: aidr reply <broker> ${REPLY_OUTCOMES.join('|')}`);
    process.exit(2);
  }
  const names = [
    ...catalogEmailTargets(loadCatalog(undefined, () => {}), { explicitNames: new Set(brokersList.map(b => b.name.toLowerCase())) }).map(t => t.name),
    ...brokersList.filter(b => b.method === 'email').map(b => b.name),
  ];
  const found = findEmailTarget(names, query);
  if (found.error) { console.error(found.error); process.exit(2); }
  const st = loadState();
  const keys = Object.keys(st.emailSent || {}).filter(k => k === found.name || k.startsWith(`${found.name}|`));
  for (const key of (keys.length ? keys : [found.name])) recordReply(st, key, outcome);
  saveState();
  console.log(`${found.name}: reply logged as ${outcome}.`);
  process.exit(0);
}
```

`saveState` and `loadState` are already imported at the top of `watcher.js` from `./lib/config`. The block runs before the module-level `state` exists, which is why it loads its own `st`.

In the `--list` block, after the catalog section and before `console.log('');`, add:

```js
  const { catalogEmailTargets } = require('./lib/catalog');
  const emailNames = [
    ...catalogEmailTargets(loadCatalog(), { explicitNames: new Set(brokers.map(b => b.name.toLowerCase())) }).map(t => t.name),
    ...brokers.filter(b => b.method === 'email').map(b => b.name),
  ];
  if (emailNames.length) {
    console.log(`\nEmail requests (${emailNames.length})`);
    console.log('-'.repeat(80));
    for (const n of emailNames) {
      const sent = (state.emailSent || {})[n];
      const reply = (state.emailReplies || {})[n];
      const status = !sent ? 'not sent' : sent.status === 'unknown' ? 'unknown' : `sent ${String(sent.at).slice(0, 10)}`;
      console.log(pad(n, 40) + pad(status, 18) + (reply ? `${reply.outcome} ${String(reply.at).slice(0, 10)}` : '-'));
    }
  }
```

In `dashboard/server.js` `/api/brokers`, replace the catalog loop with:

```js
    const { loadCatalog, catalogSummary, catalogEmailTargets } = require('../lib/catalog');
    const records = loadCatalog(undefined, () => {});
    const st = readJsonSafe(STATE, { optOuts: {} }) || {};
    const emailName = new Map(catalogEmailTargets(records).map(t => [t.domain, t.name]));
    for (const c of catalogSummary(records)) {
      if (c.state === 'unreviewed' || c.state === 'excluded') continue;
      let note = null;
      if (c.state === 'email') {
        const n = emailName.get(c.domain);
        const sent = (st.emailSent || {})[n];
        const reply = (st.emailReplies || {})[n];
        note = sent ? `email sent ${String(sent.at).slice(0, 10)}${reply ? `, reply: ${reply.outcome}` : ''}` : 'email not sent yet';
      }
      list.push({ name: c.name, method: `catalog (${c.state})`, priority: 5, usOnly: true, captchaLikely: false,
        confidence: c.reviewedAt ? `reviewed ${c.reviewedAt}` : null, optOutUrl: c.optOutUrl, note, source: 'catalog' });
    }
```

(`readJsonSafe(file, fallback)` and `STATE` already exist in `dashboard/server.js`.)

- [ ] **Step 4: Run tests**

Run: `node --test test/email-reply.test.js test/cli-map.test.js` then `npm test`
Expected: PASS. Also run `npm test` inside `dashboard/` if its tests are separate (`ls dashboard/*.test.js`; `node --test dashboard/server.test.js`).

Manual check with a throwaway state (no network):

```bash
AIDR_STATE_PATH=/tmp/aidr-reply-check.json node watcher.js --reply nobody honored; echo "exit $?"
```

Expected: `No email broker matches "nobody".`, exit 2.

- [ ] **Step 5: Commit**

```bash
git add lib/email-step.js lib/cli-map.js watcher.js dashboard/server.js test/email-reply.test.js test/cli-map.test.js
git commit -m "feat(email): aidr reply, email section in aidr list, dashboard status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Documentation

**Files:**
- Modify: `docs/UPEC-MANUAL.md` (commands table, a new "Email requests" section)
- Modify: `docs/relay.md` (point 5: the dedicated mailbox route)
- Modify: `docs/CATALOG-REVIEW.md` (the `email` state)
- Test: `test/catalog-files.test.js` already checks `CATALOG-REVIEW.md` for strings; extend it.

- [ ] **Step 1: Write the failing test**

In `test/catalog-files.test.js`, in the test `'the batch helper and the review guide exist'`, add `'"state": "email"'` to the list of required strings.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/catalog-files.test.js`
Expected: FAIL on `"state": "email"`.

- [ ] **Step 3: Write the docs**

`docs/CATALOG-REVIEW.md`, add to the list in section 3:

```markdown
- `"state": "email"` for a business broker that takes requests by email (phase 2). It needs `to` (one of the addresses in `survey.contacts`) and `basis`: `kind` (`utah` when the policy names Utah, `all-us` when it honors every US resident), `quote` (the sentence, at most 400 characters, no address) and `url` (https, on the broker's domain). A broker with a usable privacy web form is `reviewed` instead.
```

`docs/UPEC-MANUAL.md`, add a section:

```markdown
## Email requests (phase 2)

Some data brokers only take privacy requests by email. These are sent by a separate step, never by a normal run.

1. Create a new Gmail account used only for this. Turn on 2-step verification and create an app password (myaccount.google.com/apppasswords).
2. In `config.json`, set the `email` block: `smtp.host` `smtp.gmail.com`, `smtp.port` 587, `smtp.user` and `smtp.from` both the new address, `smtp.pass` the app password. Brokers see only this address.
3. Connect Mullvad, then rehearse: `node bin/aidr.js preview --email`. It lists every broker, the sentence from its policy that gives the right, and the full email. Nothing is sent.
4. Send: `node bin/aidr.js run --email`. Type `SEND` to confirm. Emails go out one every 45 seconds; leave it running. If it stops (the mailbox limit, Ctrl-C), run it again later; it never emails a broker twice.
5. Replies arrive in the new Gmail. Log each one: `node bin/aidr.js reply <broker> honored|refused|verify|none|bounced`. `aidr list` shows each email broker's status.

`aidr run` on its own (or `--forms`) fills web forms only. `--forms --email` does both.
```

and add rows to the commands table: `run --email` (sends the email requests after you type SEND) and `reply` (logs a broker's reply).

`docs/relay.md`, replace the paragraph under point 5 that recommends no `email` block with:

```markdown
5. Email-method brokers: they are sent only by `aidr run --email` (see the manual, "Email requests"). Use a separate mailbox that is not linked to you, as both `email.smtp.user` and `email.smtp.from`; the email step refuses to run when the two differ or when either is your real address. A SimpleLogin reverse-alias does not work as `from`.
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/catalog-files.test.js` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/UPEC-MANUAL.md docs/relay.md docs/CATALOG-REVIEW.md test/catalog-files.test.js
git commit -m "docs(email): email requests in the manual, relay notes and review guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
