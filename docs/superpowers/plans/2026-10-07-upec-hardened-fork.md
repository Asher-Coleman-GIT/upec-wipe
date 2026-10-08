# UPEC Hardened Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn upstream auto-identity-remove @ `99fb638` into a fork whose defaults leak only a SimpleLogin alias, never run as root, never expose the dashboard off-host, and take secrets from files/systemd credentials instead of plain-text units.

**Architecture:** Small, test-first patches (relay, egress, browser session, notifications, dashboard, secrets, permissions, deps, docs) to existing modules. Policy that is pure (relay decisions, generic gate, root refusal, dashboard startup checks, passphrase resolution) lives in tiny exported functions with unit tests; `watcher.js` / `server.js` only call them. No restructuring of upstream files beyond what each fix needs, so future upstream diffs stay reviewable.

**Tech Stack:** Node 18+ (local: 22.22.2), `node:test` + `node:assert/strict`, Playwright 1.60, express 4, nodemailer, bash, systemd user units, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-07-upec-hardened-fork-design.md` (findings F0-F12, decisions 1-9).

## Global Constraints

- Upstream base commit: `99fb638` (recorded in `UPSTREAM_BASE`). Never merge upstream without running `scripts/upstream-review.sh` and reading the diff.
- Work on local branch `upec/hardening`. No pushes. `origin` is renamed to `upstream`.
- Tests: `node --test` with `node:assert/strict`, CommonJS, `'use strict';`, file header comment like existing tests. Full suite: `npm test` (baseline 1409 pass / 0 fail, ~4 min).
- Repo text rule: **no em dash or en dash** in any tracked file (`test/` enforces this). Use a plain hyphen.
- Never log a person's real email, name or address in new log lines. Reasons may name the broker and the config key, not the value.
- SimpleLogin API: `POST https://app.simplelogin.io/api/alias/random/new?mode=word`, header `Authentication: <apiKey>`, optional JSON body `{ "note": "..." }`, success 201, address in response field `email`.
- Passphrase file name under systemd credentials: `aidr-passphrase`. Env var for an explicit file: `AIDR_PASSPHRASE_FILE`.
- Dashboard loopback hosts accepted: `127.0.0.0/8`, `::1`, `localhost`. Nothing else, no override flag.
- Root refusal applies to uid 0 on POSIX only; Windows (`process.getuid` undefined) is not affected.
- Egress check URLs: Mullvad `https://am.i.mullvad.net/json` (field `mullvad_exit_ip: boolean`); IP echo `https://api.ipify.org?format=json` (field `ip`). Config: `network.required` (default true), `network.proxy` (string, `socks5://`, `http://` or `https://`).
- Browser profile: ephemeral by default; `browser.persistentProfile: true` opts back into `config.profileDir`.
- No notification code paths remain (iMessage, toasts, webhook, emailed report). `openInBrowser` stays.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Multi-person household where one person's alias fails** - the other people must still be processed; the failed person must get zero submissions on every channel (forms, email, generic, right-to-know). Pinned in Task 2 (`buildSubmissionPlan` test) and Task 3 (email/know tests).
2. **Cached alias from an older run plus `relay.required`** - a cached alias must be reused without an API call even if the API is down today. Pinned in Task 1.
3. **Passphrase file with trailing newline / CRLF** (created with `echo` or on Windows) - must decrypt. Pinned in Task 4.
4. **`AIDR_HOST=localhost` or `::1`** - must still start; `0.0.0.0`, `192.168.x.x`, `::` must refuse. Pinned in Task 7.
5. **`smtp.from` written with display name, e.g. `"Jane <jane.doe@example.com>"`, or different case** - must be detected as the real address. Pinned in Task 1 (`smtpFromLeakReason`).
6. **VPN down, Mullvad page unreachable, or check page returns HTML/garbage** - must fail closed, never "unknown = OK". Pinned in Task 9.
7. **Run crashes mid-way** - the ephemeral profile directory must still be deleted. Pinned in Task 10 (`close()` in `finally`, test with a throwing body).

---

### Task 0: Fork scaffolding and upstream review script

**Files:**
- Create: `UPSTREAM_BASE`
- Create: `scripts/upstream-review.sh`
- Create: `FORK.md` (skeleton; filled in Task 8)
- Test: `test/upstream-review-script.test.js`

**Interfaces:**
- Produces: `UPSTREAM_BASE` (single line, the full SHA of `99fb638`); `scripts/upstream-review.sh [ref]` prints commit log + diffstat + full diff from base to `upstream/main` (or `ref`), exit 0, never modifies the work tree.

- [ ] **Step 1: Branch and remotes**

```bash
cd /mnt/c/Users/<you>/auto_identity_remove/auto-identity-remove
git checkout -b upec/hardening
git remote rename origin upstream
git remote -v   # expect only 'upstream'
git rev-parse 99fb638 > UPSTREAM_BASE
```

- [ ] **Step 2: Write the failing test**

`test/upstream-review-script.test.js`:

```js
/**
 * test/upstream-review-script.test.js
 *
 * The fork pins upstream at UPSTREAM_BASE and only pulls changes after a human
 * reads the diff. This checks the review script exists, parses, never runs a
 * mutating git command, and that the pin is a full SHA.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'upstream-review.sh');

test('UPSTREAM_BASE is a full 40-char SHA', () => {
  const sha = fs.readFileSync(path.join(ROOT, 'UPSTREAM_BASE'), 'utf8').trim();
  assert.match(sha, /^[0-9a-f]{40}$/);
});

test('upstream-review.sh parses with bash -n', () => {
  execFileSync('bash', ['-n', SCRIPT]);
});

test('upstream-review.sh never merges, rebases, resets, checks out or pushes', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  for (const verb of ['merge', 'rebase', 'reset', 'checkout', 'push', 'pull', 'cherry-pick']) {
    assert.ok(!new RegExp(`git\\s+${verb}\\b`).test(src), `script must not run git ${verb}`);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/upstream-review-script.test.js`
Expected: FAIL (`ENOENT` for the script; the SHA test passes once Step 1 ran).

- [ ] **Step 4: Write the script**

`scripts/upstream-review.sh`:

```bash
#!/usr/bin/env bash
# scripts/upstream-review.sh - show what upstream changed since this fork's pin.
#
# Usage: bash scripts/upstream-review.sh [ref]     (default ref: upstream/main)
#
# Read-only. Fetches the upstream remote, then prints the commit log, a diffstat
# and the full diff from UPSTREAM_BASE to <ref>. It never merges: after reading
# the diff, merge by hand and update UPSTREAM_BASE to the commit you reviewed.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="$(tr -d '[:space:]' < UPSTREAM_BASE)"
REF="${1:-upstream/main}"

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "No 'upstream' remote. Add it with:" >&2
  echo "  git remote add upstream https://github.com/stephenlthorn/auto-identity-remove.git" >&2
  exit 1
fi

git fetch --quiet upstream
echo "== Commits in $REF since pinned base ${BASE:0:7} =="
git --no-pager log --oneline "$BASE..$REF"
echo
echo "== Files touched =="
git --no-pager diff --stat "$BASE" "$REF"
echo
echo "== Dependency manifest changes (read these first) =="
git --no-pager diff "$BASE" "$REF" -- package.json package-lock.json dashboard/package.json dashboard/package-lock.json
echo
echo "== Full diff =="
git --no-pager diff "$BASE" "$REF"
```

`FORK.md` skeleton:

```markdown
# UPEC hardened fork

Fork of https://github.com/stephenlthorn/auto-identity-remove pinned at the commit in
`UPSTREAM_BASE`. See `docs/superpowers/specs/2026-10-07-upec-hardened-fork-design.md`
for what changed and why.

## Pulling upstream changes

    bash scripts/upstream-review.sh | less

Read the whole diff. Upstream is largely AI-written and changes quickly. Only then
merge by hand and write the reviewed commit SHA into `UPSTREAM_BASE`.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `chmod +x scripts/upstream-review.sh && node --test test/upstream-review-script.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add UPSTREAM_BASE scripts/upstream-review.sh FORK.md test/upstream-review-script.test.js docs/superpowers/specs/2026-10-07-upec-hardened-fork-design.md docs/superpowers/plans/2026-10-07-upec-hardened-fork.md
git commit -m "chore(fork): pin upstream base and add read-only upstream review script"
```

---

### Task 1: Strict SimpleLogin relay (F0, F1)

**Files:**
- Modify: `lib/relay.js` (whole module: endpoint, `getSubmissionEmail`, new helpers, exports)
- Modify: `test/relay.test.js` (fix the two tests that encode the wrong API shape; add strict tests)
- Modify: `docs/relay.md` (remove "falls back to your real email"; document `required`)

**Interfaces:**
- Produces (all exported from `lib/relay.js`):
  - `class RelayUnavailableError extends Error` (`name === 'RelayUnavailableError'`)
  - `relayConfigured(config) -> boolean` - provider in `RELAY_PROVIDERS`, non-empty `apiKey` not starting with `YOUR_`
  - `relayRequired(config) -> boolean` - `config.relay.required === true`
  - `getSubmissionEmail({ config, person, state, createImpl }) -> Promise<string>` - returns real email only when relay is not configured and not required; otherwise returns an alias or **throws `RelayUnavailableError`**
  - `smtpFromLeakReason(smtpCfg, person) -> string|null` - `null` if `smtpCfg.from` is set and does not contain `person.email` (case-insensitive); otherwise a reason string
  - `SIMPLELOGIN_ALIAS_URL === 'https://app.simplelogin.io/api/alias/random/new?mode=word'`

- [ ] **Step 1: Write the failing tests**

In `test/relay.test.js`, update the import to:

```js
const {
  getSubmissionEmail,
  personKey,
  createSimpleLoginAlias,
  relayConfigured,
  relayRequired,
  smtpFromLeakReason,
  RelayUnavailableError,
  RELAY_PROVIDERS,
  SIMPLELOGIN_ALIAS_URL,
} = require('../lib/relay');
```

Replace the test `createSimpleLoginAlias posts to the documented endpoint with Authentication header` with:

```js
test('createSimpleLoginAlias posts to /api/alias/random/new and reads the email field', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    return { ok: true, status: 201, json: async () => ({ id: 1, email: 'brave.otter123@simplelogin.com' }) };
  };

  const alias = await createSimpleLoginAlias({ apiKey: 'sl-test-key', note: 'opt-out for Jane Doe', fetchImpl });

  assert.equal(alias, 'brave.otter123@simplelogin.com');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://app.simplelogin.io/api/alias/random/new?mode=word');
  assert.equal(SIMPLELOGIN_ALIAS_URL, fetchCalls[0].url);
  assert.equal(fetchCalls[0].init.method, 'POST');
  assert.equal(fetchCalls[0].init.headers.Authentication, 'sl-test-key');
  assert.equal(JSON.parse(fetchCalls[0].init.body).note, 'opt-out for Jane Doe');
});

test('createSimpleLoginAlias rejects a 2xx response without an email field', async () => {
  const fetchImpl = async () => ({ ok: true, status: 201, json: async () => ({ alias: 'old-shape@x.io' }) });
  await assert.rejects(
    () => createSimpleLoginAlias({ apiKey: 'k', note: 'x', fetchImpl }),
    /missing "email"/
  );
});
```

Append:

```js
// -- Strict fail-closed behaviour (fork) -----------------------------------------

test('alias creation failure throws RelayUnavailableError instead of returning the real email', async () => {
  const state = makeState();
  const createImpl = async () => { throw new Error('HTTP 503'); };
  await assert.rejects(
    () => getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state, createImpl }),
    (err) => err instanceof RelayUnavailableError && /503/.test(err.message) && !err.message.includes(PERSON_A.email)
  );
  assert.equal(state.relayAliases[personKey(PERSON_A)], undefined, 'nothing cached on failure');
});

test('createImpl returning an empty alias throws', async () => {
  await assert.rejects(
    () => getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state: makeState(), createImpl: async () => '' }),
    RelayUnavailableError
  );
});

test('relay.required with no apiKey throws', async () => {
  await assert.rejects(
    () => getSubmissionEmail({ config: { relay: { provider: 'simplelogin', required: true } }, person: PERSON_A, state: makeState() }),
    /required/
  );
});

test('relay.required with the example placeholder key throws without calling the API', async () => {
  let calls = 0;
  await assert.rejects(
    () => getSubmissionEmail({
      config: { relay: { provider: 'simplelogin', apiKey: 'YOUR_SIMPLELOGIN_API_KEY', required: true } },
      person: PERSON_A, state: makeState(), createImpl: async () => { calls += 1; return 'x@y.io'; },
    }),
    RelayUnavailableError
  );
  assert.equal(calls, 0);
});

test('cached alias is reused under relay.required even when the API is down', async () => {
  const state = makeState();
  state.relayAliases = { [personKey(PERSON_A)]: 'cached@simplelogin.com' };
  const out = await getSubmissionEmail({
    config: { relay: { ...RELAY_CFG.relay, required: true } },
    person: PERSON_A, state, createImpl: async () => { throw new Error('down'); },
  });
  assert.equal(out, 'cached@simplelogin.com');
});

test('relayConfigured / relayRequired', () => {
  assert.equal(relayConfigured(RELAY_CFG), true);
  assert.equal(relayConfigured({}), false);
  assert.equal(relayConfigured({ relay: { provider: 'simplelogin', apiKey: 'YOUR_SIMPLELOGIN_API_KEY' } }), false);
  assert.equal(relayConfigured({ relay: { provider: 'firefox', apiKey: 'k' } }), false);
  assert.equal(relayRequired({ relay: { required: true } }), true);
  assert.equal(relayRequired({ relay: { required: 'yes' } }), false);
  assert.equal(relayRequired({}), false);
});

test('smtpFromLeakReason flags missing, equal, display-name and mixed-case from addresses', () => {
  const p = { email: 'jane.doe@example.com' };
  assert.match(smtpFromLeakReason({ user: 'jane.doe@example.com' }, p), /smtp\.from/);
  assert.match(smtpFromLeakReason({ from: 'jane.doe@example.com' }, p), /real email/);
  assert.match(smtpFromLeakReason({ from: 'Jane <Jane.Doe@Example.com>' }, p), /real email/);
  assert.equal(smtpFromLeakReason({ from: 'optouts@my-alias-domain.org' }, p), null);
  assert.match(smtpFromLeakReason(undefined, p), /smtp\.from/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/relay.test.js`
Expected: FAIL - `relayConfigured is not a function`, URL mismatch, no throw on failure.

- [ ] **Step 3: Implement in `lib/relay.js`**

Change the constant and the creator:

```js
// Documented in github.com/simple-login/app docs/api.md. The address is returned
// in the `email` field. The upstream code used the undocumented
// /api/alias/custom/new with only {note} and read `alias`, so it never produced
// an alias and every run fell back to the real email.
const SIMPLELOGIN_ALIAS_URL = 'https://app.simplelogin.io/api/alias/random/new?mode=word';
```

In `createSimpleLoginAlias`, replace the success tail with:

```js
  const data = await res.json();
  if (!data || !data.email) {
    throw new Error('SimpleLogin alias creation failed: response missing "email" field');
  }
  return data.email;
```

Add after `RELAY_PROVIDERS`:

```js
/** Thrown when a relay is configured or required but no alias is available. */
class RelayUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RelayUnavailableError';
  }
}

function relayConfigured(config) {
  const relay = config && config.relay;
  if (!relay || !RELAY_PROVIDERS.includes(relay.provider)) return false;
  const key = typeof relay.apiKey === 'string' ? relay.apiKey.trim() : '';
  return key !== '' && !key.startsWith('YOUR_');
}

function relayRequired(config) {
  return !!(config && config.relay && config.relay.required === true);
}

/**
 * When an alias is advertised, the SMTP envelope must not carry the real
 * address, or the broker learns it from the From header anyway.
 * Returns null when safe, else a reason (never containing the address itself).
 */
function smtpFromLeakReason(smtpCfg, person) {
  const from = smtpCfg && typeof smtpCfg.from === 'string' ? smtpCfg.from.trim() : '';
  if (!from) return 'email.smtp.from is not set, so mail would go out from the SMTP login';
  const real = person && person.email ? String(person.email).trim().toLowerCase() : '';
  if (real && from.toLowerCase().includes(real)) return 'email.smtp.from is your real email';
  return null;
}
```

Replace the body of `getSubmissionEmail` (keep its JSDoc but change the fallback sentence to "On any creation error it throws RelayUnavailableError: a relay outage blocks that person's submissions rather than leaking the real address."):

```js
async function getSubmissionEmail({ config, person, state, createImpl }) {
  const rawEmail = (person && person.email) || '';

  if (!relayConfigured(config)) {
    if (relayRequired(config)) {
      throw new RelayUnavailableError('config.relay.required is true but no usable relay is configured (provider "simplelogin" + apiKey)');
    }
    return rawEmail;
  }

  const relay = config.relay;
  const key = personKey(person);
  const store = state || {};
  if (!store.relayAliases) store.relayAliases = {};

  const cached = store.relayAliases[key];
  if (cached) return cached;

  const make = createImpl || defaultCreateImpl;
  let alias;
  try {
    alias = await make({
      provider: relay.provider,
      apiKey: relay.apiKey,
      note: `auto-identity-remove opt-out for ${person.fullName || key}`,
    });
  } catch (err) {
    throw new RelayUnavailableError(`Relay alias creation failed: ${err.message}`);
  }
  if (!alias) throw new RelayUnavailableError('Relay alias creation returned no alias');
  store.relayAliases[key] = alias;
  return alias;
}
```

Exports:

```js
module.exports = {
  getSubmissionEmail,
  personKey,
  createSimpleLoginAlias,
  defaultCreateImpl,
  relayConfigured,
  relayRequired,
  smtpFromLeakReason,
  RelayUnavailableError,
  RELAY_PROVIDERS,
  SIMPLELOGIN_ALIAS_URL,
};
```

- [ ] **Step 4: Update `docs/relay.md`**

In SimpleLogin step 3 add `"required": true` to the JSON example. Replace step 4 with:

```markdown
4. Run the tool normally. On the first run per person it POSTs to
   `https://app.simplelogin.io/api/alias/random/new?mode=word` (header
   `Authentication: <apiKey>`) and caches the returned alias in `state.json`.
   **If the API call fails, that person gets no submissions this run** - no
   forms, no emails, no generic pass. With `"required": true` the run refuses to
   start at all unless a relay is configured. Your real email is never used as a
   fallback.
5. Set `email.smtp.from` to an address that is not your real email (for example
   a SimpleLogin reverse-alias or a mailbox on your own domain). While an alias is
   in use, email opt-outs and right-to-know requests are skipped and listed as
   manual if `from` is missing or is your real address.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/relay.test.js`
Expected: PASS (all, including the 5 original behaviour tests that still apply).

- [ ] **Step 6: Commit**

```bash
git add lib/relay.js test/relay.test.js docs/relay.md
git commit -m "fix(relay): use the documented SimpleLogin endpoint and fail closed instead of leaking the real email"
```

---

### Task 2: Generic pass opt-in, relay applied to every web submission (F2)

**Files:**
- Create: `lib/submission-plan.js`
- Test: `test/submission-plan.test.js`
- Modify: `watcher.js` (flag at top ~line 52; startup relay plan before the person loop ~line 885; generic loop ~line 987; banner line ~764)
- Modify: `config.example.json` (add `generic`, `relay.required`)

**Interfaces:**
- Consumes: `getSubmissionEmail`, `RelayUnavailableError`, `relayConfigured` from Task 1.
- Produces (`lib/submission-plan.js`):
  - `isGenericEnabled(argv: string[], config: object) -> boolean` - `argv.includes('--generic') || config?.generic?.enabled === true`
  - `buildSubmissionPlan({ config, persons, state, createImpl? }) -> Promise<{ allowed: Array<{ person, email, masked: boolean }>, blocked: Array<{ person, reason: string }> }>` - order of `persons` preserved; a non-`RelayUnavailableError` is rethrown
  - `withSubmissionEmail(person, email) -> object` - shallow copy with `email` replaced (returns `person` itself when equal)

- [ ] **Step 1: Write the failing test**

`test/submission-plan.test.js`:

```js
/**
 * test/submission-plan.test.js
 *
 * Fork policy: the generic pass is opt-in, and every web submission for a person
 * uses the relay alias resolved once up front. A person whose alias cannot be
 * obtained is blocked; everyone else still runs.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isGenericEnabled, buildSubmissionPlan, withSubmissionEmail } = require('../lib/submission-plan');

const A = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: 'jane@example.com' };
const B = { firstName: 'John', lastName: 'Roe', fullName: 'John Roe', email: 'john@example.com' };
const RELAY = { relay: { provider: 'simplelogin', apiKey: 'k' } };

test('generic pass is off by default', () => {
  assert.equal(isGenericEnabled(['node', 'watcher.js'], {}), false);
  assert.equal(isGenericEnabled(['node', 'watcher.js'], { generic: { enabled: 'true' } }), false);
});

test('generic pass turns on with --generic or generic.enabled === true', () => {
  assert.equal(isGenericEnabled(['node', 'watcher.js', '--generic'], {}), true);
  assert.equal(isGenericEnabled(['node', 'watcher.js'], { generic: { enabled: true } }), true);
});

test('no relay: everyone allowed with real email, masked=false', async () => {
  const plan = await buildSubmissionPlan({ config: {}, persons: [A, B], state: {} });
  assert.deepEqual(plan.allowed.map(x => [x.email, x.masked]), [['jane@example.com', false], ['john@example.com', false]]);
  assert.equal(plan.blocked.length, 0);
});

test('one alias failure blocks only that person', async () => {
  const createImpl = async ({ note }) => {
    if (note.includes('Jane')) throw new Error('HTTP 500');
    return 'john-alias@simplelogin.com';
  };
  const plan = await buildSubmissionPlan({ config: RELAY, persons: [A, B], state: {}, createImpl });
  assert.equal(plan.allowed.length, 1);
  assert.equal(plan.allowed[0].person, B);
  assert.equal(plan.allowed[0].email, 'john-alias@simplelogin.com');
  assert.equal(plan.allowed[0].masked, true);
  assert.equal(plan.blocked.length, 1);
  assert.equal(plan.blocked[0].person, A);
  assert.match(plan.blocked[0].reason, /500/);
});

test('unexpected errors are not swallowed', async () => {
  // Only RelayUnavailableError means "block this person"; a programming error
  // (here: persons is not iterable) must surface.
  await assert.rejects(() => buildSubmissionPlan({ config: RELAY, persons: null, state: {} }), TypeError);
});

test('withSubmissionEmail swaps only the email', () => {
  const p = withSubmissionEmail(A, 'alias@simplelogin.com');
  assert.notEqual(p, A);
  assert.equal(p.email, 'alias@simplelogin.com');
  assert.equal(p.firstName, 'Jane');
  assert.equal(A.email, 'jane@example.com', 'original not mutated');
  assert.equal(withSubmissionEmail(A, A.email), A);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/submission-plan.test.js`
Expected: FAIL - `Cannot find module '../lib/submission-plan'`.

- [ ] **Step 3: Implement `lib/submission-plan.js`**

```js
/**
 * lib/submission-plan.js
 *
 * Fork policy helpers used by watcher.js.
 *
 * - isGenericEnabled: the ~490-site heuristic generic pass is opt-in. It submits
 *   name, email, state and zip to sites chosen from public datasets, with no
 *   per-site review, so it stays off unless asked for.
 * - buildSubmissionPlan: resolve each person's submission email once, before any
 *   browser work. A person whose relay alias is unavailable is blocked for the
 *   whole run on every channel; other people still run.
 */

'use strict';

const { getSubmissionEmail, RelayUnavailableError } = require('./relay');

function isGenericEnabled(argv, config) {
  if (Array.isArray(argv) && argv.includes('--generic')) return true;
  return !!(config && config.generic && config.generic.enabled === true);
}

async function buildSubmissionPlan({ config, persons, state, createImpl }) {
  const allowed = [];
  const blocked = [];
  for (const person of persons) {
    try {
      const email = await getSubmissionEmail({ config, person, state, createImpl });
      allowed.push({ person, email, masked: email !== person.email });
    } catch (err) {
      if (!(err instanceof RelayUnavailableError)) throw err;
      blocked.push({ person, reason: err.message });
    }
  }
  return { allowed, blocked };
}

function withSubmissionEmail(person, email) {
  if (!email || email === person.email) return person;
  return { ...person, email };
}

module.exports = { isGenericEnabled, buildSubmissionPlan, withSubmissionEmail };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/submission-plan.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Wire into `watcher.js`**

At the top with the other requires (after line 20):

```js
const { isGenericEnabled, buildSubmissionPlan, withSubmissionEmail } = require('./lib/submission-plan');
```

Replace the banner line (~764):

```js
  const GENERIC_ENABLED = isGenericEnabled(process.argv, config);
  console.log(`📋 ${brokers.length} explicit brokers${GENERIC_ENABLED ? ' + 500+ generic' : ' (generic pass off - pass --generic to enable)'} | re-check window: ${RECHECK_DAYS} days\n`);
```

Just before `for (const person of persons) {` (~line 885) insert:

```js
  // Resolve every person's submission email up front (fork: fail closed). A
  // person whose relay alias is unavailable gets no submissions on any channel.
  const plan = await buildSubmissionPlan({ config, persons, state });
  for (const b of plan.blocked) {
    console.error(`⛔ Skipping ${b.person.firstName} ${b.person.lastName}: ${b.reason}`);
  }
  if (plan.allowed.length === 0) {
    console.error('⛔ No person has a usable submission email. Nothing submitted.');
    saveState();
    await context.close().catch(() => {});
    process.exitCode = 1;
    return;
  }
```

Change the loop header and the old resolution lines (~885-898) to:

```js
  for (const { person, email: submissionEmail, masked } of plan.allowed) {
    if (persons.length > 1) {
      console.log(`\n${'='.repeat(54)}`);
      console.log(`Running for: ${person.firstName} ${person.lastName}`);
      console.log('='.repeat(54));
    }
    if (masked) console.log(`   Using masked email for submissions: ${submissionEmail}`);
    else console.log('   ⚠ No relay configured: brokers will receive your real email.');
```

(delete the old `const submissionEmail = await getSubmissionEmail(...)` and its `if` log). Leave the rest of the loop body unchanged.

Replace the generic loop (~987-1016) with:

```js
  const genericTotals = {};
  if (GENERIC_ENABLED) {
    for (const { person, email } of plan.allowed) {
      if (persons.length > 1) {
        console.log(`\n── Generic brokers for ${person.firstName} ${person.lastName} ──`);
      }
      // getFieldMap() fills email fields from person.email, so hand it the
      // alias-bearing copy. stateKey() keys on names, so state is unaffected.
      const genericResult = await runGenericBrokers(context, explicitHosts, state, logResult, recordSuccess, {
        dryRun: DRY_RUN,
        person: withSubmissionEmail(person, email),
        personCount: persons.length,
      });
      if (genericResult && genericResult.genericStats) {
        for (const [k, v] of Object.entries(genericResult.genericStats)) {
          genericTotals[k] = (genericTotals[k] || 0) + (typeof v === 'number' ? v : 0);
        }
      }
    }
  } else {
    console.log('\n── Generic brokers: off (fork default; --generic or generic.enabled to opt in) ──');
  }
  results.genericStats = genericTotals;
```

Remove the now-unused `getSubmissionEmail` import from line 20 if `grep -n getSubmissionEmail watcher.js` shows no other use.

- [ ] **Step 6: `config.example.json`**

Add before `"profileDir"`:

```json
  "generic": {
    "_comment": "Heuristic pass over ~490 sites from public datasets. Off in this fork. Set enabled to true (or pass --generic) to opt in; it uses your relay alias.",
    "enabled": false
  },
```

and in `"relay"` add `"required": true` plus change its `_comment` to say: `"Fork default: required. Without a working SimpleLogin relay the run refuses to start. See docs/relay.md."`

- [ ] **Step 7: Verify**

Run: `node --check watcher.js && node --test test/submission-plan.test.js test/relay.test.js test/generic-runner-per-person.test.js`
Expected: `node --check` silent; all PASS.

Run: `npm test 2>&1 | tail -8`
Expected: `fail 0`.

- [ ] **Step 8: Commit**

```bash
git add lib/submission-plan.js test/submission-plan.test.js watcher.js config.example.json
git commit -m "feat(fork): generic pass opt-in; resolve relay alias per person up front and use it for generic forms"
```

---

### Task 3: Email channels never leak the real address (F3, F4)

**Files:**
- Modify: `lib/email.js` (`_sendViaSMTP`)
- Modify: `lib/right-to-know-runner.js` (`_sendViaSMTP`, `sendKnowRequests`)
- Modify: `watcher.js` (KNOW_MODE block ~line 668; email opt-out call ~line 908)
- Test: `test/email-relay.test.js` (append), `test/right-to-know-relay.test.js` (create)

**Interfaces:**
- Consumes: `smtpFromLeakReason` (Task 1), `buildSubmissionPlan`, `withSubmissionEmail` (Task 2).
- Produces: `sendKnowRequests(brokers, cfg, { dryRun, submissionEmailFor?, blockedPersons? })` - `submissionEmailFor(person) -> string|undefined`; `blockedPersons: Set<object>` skipped entirely. Result shape unchanged `{ sent, manual, errors }`.
- Rule in both senders: when a `submissionEmail` differing from `person.email` is in play and `smtpFromLeakReason(smtpCfg, person)` is non-null -> do not send; `logResult(broker.name, 'manual', <reason + "fix email.smtp.from">)`; no state recorded.

- [ ] **Step 1: Write the failing tests**

Append to `test/email-relay.test.js`:

```js
test('masked email + smtp.from equal to the real email: nothing sent, logged manual', async () => {
  const { freshEmail, nmCalls, restore } = loadFreshEmailWithSmtpMock();
  const logged = [];
  patchDeps();
  loggerMod.logResult = (name, status, detail) => logged.push({ name, status, detail });
  try {
    const cfg = { person: PERSON, email: { smtp: { ...SMTP_CFG, from: 'Jane <jane.doe@example.com>' } } };
    await freshEmail.sendOptOutEmails([EMAIL_BROKER], cfg, 'linux', { submissionEmailFor: () => 'alias@simplelogin.com' });
    assert.equal(nmCalls.length, 0, 'must not send');
    assert.equal(logged[0].status, 'manual');
    assert.match(logged[0].detail, /smtp\.from/);
    assert.ok(!logged[0].detail.includes('jane.doe@example.com'));
  } finally { restoreDeps(); restore(); }
});

test('masked email + no smtp.from: nothing sent', async () => {
  const { freshEmail, nmCalls, restore } = loadFreshEmailWithSmtpMock();
  patchDeps();
  try {
    const { from, ...noFrom } = SMTP_CFG;
    const cfg = { person: PERSON, email: { smtp: noFrom } };
    await freshEmail.sendOptOutEmails([EMAIL_BROKER], cfg, 'linux', { submissionEmailFor: () => 'alias@simplelogin.com' });
    assert.equal(nmCalls.length, 0);
  } finally { restoreDeps(); restore(); }
});

test('masked email + safe smtp.from: sent from smtp.from', async () => {
  const { freshEmail, nmCalls, restore } = loadFreshEmailWithSmtpMock();
  patchDeps();
  try {
    const cfg = { person: PERSON, email: { smtp: SMTP_CFG } };
    await freshEmail.sendOptOutEmails([EMAIL_BROKER], cfg, 'linux', { submissionEmailFor: () => 'alias@simplelogin.com' });
    assert.equal(nmCalls.length, 1);
    assert.equal(nmCalls[0].from, 'u@x.com');
  } finally { restoreDeps(); restore(); }
});
```

Create `test/right-to-know-relay.test.js`:

```js
/**
 * test/right-to-know-relay.test.js
 *
 * Right-to-know requests must use the relay alias in the body, skip blocked
 * persons, and refuse to send From the real address while an alias is in use.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const PERSON = {
  fullName: 'Jane Doe', firstName: 'Jane', lastName: 'Doe', city: 'Austin', state: 'TX',
  zip: '73301', email: 'jane.doe@example.com', phoneFormatted: '(512) 555-0000', country: 'US',
};
const BROKER = { name: 'Pipl', method: 'email', emailTo: 'removal@pipl.com' };
const SMTP = { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p', from: 'optouts@alias.org' };

const configMod = require('../lib/config');
const loggerMod = require('../lib/logger');

function load() {
  const sent = [];
  const logged = [];
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'nodemailer') {
      return { createTransport: () => ({ sendMail: async (m) => { sent.push(m); return {}; } }) };
    }
    return origLoad.apply(this, arguments);
  };
  const origRecord = configMod.recordKnowRequest;
  const origLog = loggerMod.logResult;
  configMod.recordKnowRequest = () => {};
  loggerMod.logResult = (name, status, detail) => logged.push({ name, status, detail });
  delete require.cache[require.resolve('../lib/right-to-know-runner')];
  const mod = require('../lib/right-to-know-runner');
  return {
    mod, sent, logged,
    restore() {
      Module._load = origLoad;
      configMod.recordKnowRequest = origRecord;
      loggerMod.logResult = origLog;
      delete require.cache[require.resolve('../lib/right-to-know-runner')];
    },
  };
}

test('alias replaces the real email in the know-request body', async () => {
  const h = load();
  try {
    await h.mod.sendKnowRequests([BROKER], { person: PERSON, email: { smtp: SMTP } }, { submissionEmailFor: () => 'alias@simplelogin.com' });
    assert.equal(h.sent.length, 1);
    assert.ok(h.sent[0].text.includes('alias@simplelogin.com'));
    assert.ok(!h.sent[0].text.includes('jane.doe@example.com'));
    assert.equal(h.sent[0].replyTo, 'alias@simplelogin.com');
  } finally { h.restore(); }
});

test('blocked person gets no know request', async () => {
  const h = load();
  try {
    const r = await h.mod.sendKnowRequests([BROKER], { person: PERSON, email: { smtp: SMTP } }, { blockedPersons: new Set([PERSON]) });
    assert.equal(h.sent.length, 0);
    assert.deepEqual(r.sent, []);
  } finally { h.restore(); }
});

test('alias in use + smtp.from is the real email: logged manual, not sent', async () => {
  const h = load();
  try {
    const cfg = { person: PERSON, email: { smtp: { ...SMTP, from: 'jane.doe@example.com' } } };
    const r = await h.mod.sendKnowRequests([BROKER], cfg, { submissionEmailFor: () => 'alias@simplelogin.com' });
    assert.equal(h.sent.length, 0);
    assert.deepEqual(r.manual, ['Pipl']);
    assert.ok(!h.logged.some(l => String(l.detail).includes('jane.doe@example.com')));
  } finally { h.restore(); }
});
```

Note: `cfg.person` vs `getPersonsFromConfig` may return a normalized copy rather than the same object. If the `blockedPersons` test fails for identity reasons, change the runner to compare with `personKey()` from `lib/relay.js` and build the set from keys (`blockedKeys: Set<string>`), and update the interface line above and the watcher wiring accordingly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/email-relay.test.js test/right-to-know-relay.test.js`
Expected: FAIL - mail is sent with the real `from`; know body has the real email.

- [ ] **Step 3: Implement `lib/email.js`**

Add `const { smtpFromLeakReason } = require('./relay');` with the other requires. At the start of `_sendViaSMTP`, before requiring nodemailer:

```js
  const masked = !!submissionEmail && submissionEmail !== person.email;
  if (masked) {
    const leak = smtpFromLeakReason(smtpCfg, person);
    if (leak) {
      loggerMod.logResult(broker.name, 'manual', `${broker.emailTo} - not sent: ${leak}. Set email.smtp.from to a non-real address.`);
      return;
    }
  }
```

and change `from: smtpCfg.from || smtpCfg.user,` to `from: masked ? smtpCfg.from : (smtpCfg.from || smtpCfg.user),`.

- [ ] **Step 4: Implement `lib/right-to-know-runner.js`**

Add `const { smtpFromLeakReason } = require('./relay');`. Change `_sendViaSMTP(broker, request, smtpCfg)` to `_sendViaSMTP(broker, request, smtpCfg, replyTo)` and in `sendMail` add `...(replyTo ? { replyTo } : {})`. In `sendKnowRequests`:

```js
  const submissionEmailFor = opts.submissionEmailFor || (() => undefined);
  const blockedPersons = opts.blockedPersons || new Set();
```

and replace the inner loop head with:

```js
    for (const person of persons) {
      if (blockedPersons.has(person)) continue;
      const alias = submissionEmailFor(person);
      const masked = !!alias && alias !== person.email;
      const request = buildKnowRequest({ person: masked ? { ...person, email: alias } : person, broker });
      const leak = masked && smtpCfg ? smtpFromLeakReason(smtpCfg, person) : null;
```

Then in the `if (smtpCfg)` branch, first:

```js
      if (smtpCfg && leak) {
        loggerMod.logResult(broker.name, 'manual', `Right-to-know -> ${broker.emailTo} not sent: ${leak}. Set email.smtp.from to a non-real address.`);
        manual.push(broker.name);
        continue;
      }
```

(placed after the `dryRun` block and before `if (smtpCfg)`), and call `_sendViaSMTP(broker, request, smtpCfg, masked ? alias : undefined)`.

- [ ] **Step 5: Wire `watcher.js`**

Email opt-outs call (~line 908): `submissionEmailFor` already returns `submissionEmail` for the current person - no change needed beyond Task 2's loop variable. Confirm with `grep -n "submissionEmailFor" watcher.js`.

KNOW_MODE block: replace `const result = await sendKnowRequests(brokers, config, { dryRun: DRY_RUN });` with:

```js
    const { buildSubmissionPlan } = require('./lib/submission-plan');
    const plan = await buildSubmissionPlan({ config, persons, state });
    for (const b of plan.blocked) console.error(`⛔ Skipping ${b.person.firstName} ${b.person.lastName}: ${b.reason}`);
    const aliasFor = new Map(plan.allowed.map(a => [a.person, a.email]));
    const result = await sendKnowRequests(brokers, config, {
      dryRun: DRY_RUN,
      submissionEmailFor: (p) => aliasFor.get(p),
      blockedPersons: new Set(plan.blocked.map(b => b.person)),
    });
    if (!DRY_RUN) saveState();
```

Check that `config`, `persons`, `state`, `saveState` are in scope at that point (`grep -n "^const config\|^const persons\|^const state" watcher.js`). They are defined at ~646-651, **after** the KNOW block (~655 is the `if (KNOW_MODE)`): confirm the order; if the KNOW block is after line 651 they are in scope. Note `sendKnowRequests` receives `config` whose persons come from `getPersonsFromConfig(config)` - the same function `persons` came from, so identity holds only if it returns the same objects; if not, apply the `personKey` fallback from Step 1's note.

- [ ] **Step 6: Run tests**

Run: `node --test test/email-relay.test.js test/right-to-know-relay.test.js test/right-to-know-runner.test.js test/email.test.js test/email-multi-person.test.js && node --check watcher.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/email.js lib/right-to-know-runner.js watcher.js test/email-relay.test.js test/right-to-know-relay.test.js
git commit -m "fix(email): never send From the real address while an alias is advertised; route know-requests through the relay"
```

---

### Task 4: Passphrase from file or systemd credentials (F7)

**Files:**
- Modify: `lib/config.js` (`getPassphrase`, new `readPassphraseFile`, exports)
- Modify: `setup.js` (lines ~48, ~296: use `getPassphrase()`)
- Modify: `dashboard/server.js` (line 59: use `getPassphrase()`)
- Test: `test/passphrase-sources.test.js`

**Interfaces:**
- Produces (`lib/config.js`):
  - `PASSPHRASE_FILE_ENV = 'AIDR_PASSPHRASE_FILE'`, `CREDENTIAL_NAME = 'aidr-passphrase'`
  - `readPassphraseFile(filePath, { checkMode = true } = {}) -> string` - strips one trailing `\r?\n`; throws if `checkMode` and `(mode & 0o077) !== 0` on non-Windows; throws on empty
  - `getPassphrase(override, env = process.env) -> string` - order: override -> `env.AIDR_PASSPHRASE` -> `env.AIDR_PASSPHRASE_FILE` -> `env.CREDENTIALS_DIRECTORY/aidr-passphrase` (if exists; `checkMode: false`, systemd owns its mode) -> `''`

- [ ] **Step 1: Write the failing test**

`test/passphrase-sources.test.js`:

```js
/**
 * test/passphrase-sources.test.js
 *
 * The passphrase may come from AIDR_PASSPHRASE, a file named by
 * AIDR_PASSPHRASE_FILE, or a systemd credential (LoadCredential=aidr-passphrase:...).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getPassphrase, readPassphraseFile } = require('../lib/config');

function tmpFile(content, mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-pp-'));
  const f = path.join(dir, 'pp');
  fs.writeFileSync(f, content, { mode: mode || 0o600 });
  fs.chmodSync(f, mode || 0o600);
  return { dir, f };
}
const POSIX = process.platform !== 'win32';

test('override beats everything', () => {
  assert.equal(getPassphrase('ov', { AIDR_PASSPHRASE: 'env' }), 'ov');
});

test('env var beats file', () => {
  const { f } = tmpFile('file\n');
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE: 'env', AIDR_PASSPHRASE_FILE: f }), 'env');
});

test('AIDR_PASSPHRASE_FILE is read and one trailing LF or CRLF stripped', () => {
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: tmpFile('s3cret\n').f }), 's3cret');
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: tmpFile('s3cret\r\n').f }), 's3cret');
  assert.equal(getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: tmpFile('  spaced  ').f }), '  spaced  ');
});

test('systemd CREDENTIALS_DIRECTORY/aidr-passphrase is used', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-cred-'));
  fs.writeFileSync(path.join(dir, 'aidr-passphrase'), 'fromcred');
  assert.equal(getPassphrase(undefined, { CREDENTIALS_DIRECTORY: dir }), 'fromcred');
});

test('missing credential file under CREDENTIALS_DIRECTORY yields empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-cred-'));
  assert.equal(getPassphrase(undefined, { CREDENTIALS_DIRECTORY: dir }), '');
});

test('nothing set yields empty string', () => {
  assert.equal(getPassphrase(undefined, {}), '');
});

test('group/world-readable passphrase file is refused', { skip: !POSIX }, () => {
  const { f } = tmpFile('x', 0o644);
  assert.throws(() => readPassphraseFile(f), /readable by other users/);
  assert.throws(() => getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: f }), /readable by other users/);
});

test('empty passphrase file is refused', () => {
  assert.throws(() => readPassphraseFile(tmpFile('\n').f), /empty/);
});

test('missing AIDR_PASSPHRASE_FILE path throws a clear error', () => {
  assert.throws(() => getPassphrase(undefined, { AIDR_PASSPHRASE_FILE: '/nonexistent/aidr' }), /AIDR_PASSPHRASE_FILE/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/passphrase-sources.test.js`
Expected: FAIL - `readPassphraseFile is not a function`; file sources ignored.

- [ ] **Step 3: Implement in `lib/config.js`**

Replace `getPassphrase`:

```js
// Optional file holding the passphrase (Docker secret, systemd credential, etc).
const PASSPHRASE_FILE_ENV = 'AIDR_PASSPHRASE_FILE';
// Name used with systemd LoadCredential=aidr-passphrase:/path/to/file.
const CREDENTIAL_NAME = 'aidr-passphrase';

function readPassphraseFile(filePath, opts) {
  const checkMode = !opts || opts.checkMode !== false;
  const st = fs.statSync(filePath);
  if (checkMode && process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    throw new Error(`Passphrase file ${filePath} is readable by other users. Run: chmod 600 "${filePath}"`);
  }
  const value = fs.readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
  if (!value) throw new Error(`Passphrase file ${filePath} is empty`);
  return value;
}

// Resolve the active passphrase. Order: explicit override, AIDR_PASSPHRASE,
// AIDR_PASSPHRASE_FILE, then a systemd credential. '' when none is available.
function getPassphrase(override, env) {
  const e = env || process.env;
  if (override !== undefined && override !== null && override !== '') return override;
  if (e[PASSPHRASE_ENV]) return e[PASSPHRASE_ENV];
  if (e[PASSPHRASE_FILE_ENV]) {
    try {
      return readPassphraseFile(e[PASSPHRASE_FILE_ENV]);
    } catch (err) {
      if (err.code === 'ENOENT') throw new Error(`${PASSPHRASE_FILE_ENV} points to a missing file: ${e[PASSPHRASE_FILE_ENV]}`);
      throw err;
    }
  }
  if (e.CREDENTIALS_DIRECTORY) {
    const cred = path.join(e.CREDENTIALS_DIRECTORY, CREDENTIAL_NAME);
    if (fs.existsSync(cred)) return readPassphraseFile(cred, { checkMode: false });
  }
  return '';
}
```

Add `PASSPHRASE_FILE_ENV`, `CREDENTIAL_NAME`, `readPassphraseFile` to `module.exports`.

Update the error text at lines ~157, ~171, ~268, ~287 from `Set ${PASSPHRASE_ENV}.` to `Set ${PASSPHRASE_ENV} or ${PASSPHRASE_FILE_ENV}.`

- [ ] **Step 4: Callers**

`setup.js` line ~48: `const passphrase = o.passphrase !== undefined ? o.passphrase : getPassphrase();` and line ~296: `maybeEncryptConfig({ passphrase: getPassphrase() })`. Add `getPassphrase` to setup.js's existing `require('./lib/config')` destructure (check with `grep -n "require('./lib/config')" setup.js`; add one if absent).

`dashboard/server.js` line 59: change `const { isConfigEncrypted } = require('../lib/config');` to `const { isConfigEncrypted, getPassphrase } = require('../lib/config');` and `const CONFIG_PASSPHRASE = getPassphrase();`.

`watcher.js` line ~145 message: `Set ${PASSPHRASE_ENV} or AIDR_PASSPHRASE_FILE and re-run.`

- [ ] **Step 5: Run tests**

Run: `node --test test/passphrase-sources.test.js test/config-encryption.test.js test/secrets.test.js test/watcher-encrypt-cli.test.js test/brokers-encrypted-config.test.js test/generic-runner-encryption.test.js && (cd dashboard && node --test)`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/config.js setup.js dashboard/server.js watcher.js test/passphrase-sources.test.js
git commit -m "feat(secrets): read the config passphrase from AIDR_PASSPHRASE_FILE or a systemd credential"
```

---

### Task 5: `run.sh` umask + encrypted config; hardened systemd user unit (F8, F9)

**Files:**
- Modify: `run.sh`
- Modify: `lib/scheduler.js` (`buildSystemdUnits`, `installSystemd`)
- Test: `test/scheduler.test.js` (append), `test/run-sh.test.js` (create)

**Interfaces:**
- Produces: `buildSystemdUnits(scriptPath, logDir, opts = {}) -> { service, timer }`; `opts.passphraseFile` (absolute path) adds `LoadCredential=aidr-passphrase:<path>`. Service always contains `UMask=0077` and `NoNewPrivileges=yes`.
- `installSystemd` passes `passphraseFile` = `~/.config/auto-identity-remove/passphrase` when that file exists.

- [ ] **Step 1: Write the failing tests**

Append to `test/scheduler.test.js`:

```js
test('systemd service sets UMask=0077 and NoNewPrivileges', () => {
  const { service } = buildSystemdUnits('/home/u/aidr/run.sh', '/home/u/aidr/logs');
  assert.match(service, /^UMask=0077$/m);
  assert.match(service, /^NoNewPrivileges=yes$/m);
  assert.doesNotMatch(service, /^User=root/m);
  assert.doesNotMatch(service, /AIDR_PASSPHRASE=/);
});

test('systemd service loads the passphrase as a credential when given a file', () => {
  const { service } = buildSystemdUnits('/s/run.sh', '/s/logs', { passphraseFile: '/home/u/.config/auto-identity-remove/passphrase' });
  assert.match(service, /^LoadCredential=aidr-passphrase:\/home\/u\/\.config\/auto-identity-remove\/passphrase$/m);
});

test('systemd service has no LoadCredential line by default', () => {
  const { service } = buildSystemdUnits('/s/run.sh', '/s/logs');
  assert.doesNotMatch(service, /LoadCredential/);
});
```

Create `test/run-sh.test.js`:

```js
/**
 * test/run-sh.test.js
 *
 * run.sh is what every scheduler invokes. It must create files owner-only and
 * must accept an encrypted-only setup (config.json.enc without config.json).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'run.sh'), 'utf8');

test('run.sh parses', () => { execFileSync('bash', ['-n', path.join(__dirname, '..', 'run.sh')]); });

test('run.sh sets umask 077 before running node', () => {
  const u = SRC.indexOf('umask 077');
  assert.ok(u !== -1, 'umask 077 missing');
  assert.ok(u < SRC.indexOf('node watcher.js'));
});

test('run.sh accepts config.json.enc', () => {
  assert.match(SRC, /config\.json\.enc/);
});

test('run.sh refuses to run as root', () => {
  assert.match(SRC, /id -u/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/scheduler.test.js test/run-sh.test.js`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

`run.sh`:

```bash
#!/bin/bash
# auto-identity-remove - manual trigger and scheduler entrypoint
# Usage: ./run.sh [watcher.js flags]

set -e
umask 077
cd "$(dirname "$0")"

if [ "$(id -u)" = "0" ]; then
  echo "Refusing to run as root. Use a dedicated unprivileged user or Docker." >&2
  exit 1
fi

if [ ! -f config.json ] && [ ! -f config.json.enc ]; then
  echo "config.json not found. Run: node setup.js" >&2
  exit 1
fi

# Platform-aware Playwright browsers path
if [ -z "${PLAYWRIGHT_BROWSERS_PATH}" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    export PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"
  else
    export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
  fi
fi

node watcher.js "$@"
```

`lib/scheduler.js` `buildSystemdUnits`:

```js
function buildSystemdUnits(scriptPath, logDir, opts) {
  const o = opts || {};
  const credLine = o.passphraseFile ? `LoadCredential=aidr-passphrase:${o.passphraseFile}\n` : '';
  const service = `[Unit]
Description=auto-identity-remove monthly opt-out runner
After=network.target

[Service]
Type=oneshot
UMask=0077
NoNewPrivileges=yes
${credLine}ExecStart=/bin/bash ${scriptPath}
StandardOutput=append:${logDir}/systemd.log
StandardError=append:${logDir}/systemd.error.log

[Install]
WantedBy=default.target
`;
```

(timer unchanged). In `installSystemd`:

```js
  const ppFile = path.join(os.homedir(), '.config', 'auto-identity-remove', 'passphrase');
  const { service, timer } = buildSystemdUnits(scriptPath, logDir, fs.existsSync(ppFile) ? { passphraseFile: ppFile } : {});
  fs.writeFileSync(path.join(unitDir, `${JOB_NAME}.service`), service, { mode: 0o600 });
  fs.writeFileSync(path.join(unitDir, `${JOB_NAME}.timer`), timer, { mode: 0o600 });
```

- [ ] **Step 4: Run tests**

Run: `node --test test/scheduler.test.js test/run-sh.test.js test/scheduler-crontab-injection.test.js`
Expected: PASS. If an existing scheduler test snapshots the exact service text, update its expected string to include the two new lines.

- [ ] **Step 5: Commit**

```bash
git add run.sh lib/scheduler.js test/scheduler.test.js test/run-sh.test.js
git commit -m "fix(run): umask 077, refuse root, accept encrypted config; harden systemd user unit with LoadCredential"
```

---

### Task 6: Refuse to run as root (F12)

**Files:**
- Create: `lib/privilege.js`
- Test: `test/privilege.test.js`
- Modify: `watcher.js` (top, after requires), `setup.js` (inside `if (require.main === module)`), `dashboard/server.js` (inside `if (require.main === module)`)

**Interfaces:**
- Produces: `rootRefusal(uid: number|undefined) -> string|null` - message when `uid === 0`, else `null`. `exitIfRoot(proc = process)` - prints and `proc.exit(1)` when refused.

- [ ] **Step 1: Write the failing test**

```js
/**
 * test/privilege.test.js
 *
 * The fork never runs as root: config holds PII and the browser runs untrusted
 * pages, so a compromise should stay inside an unprivileged account.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rootRefusal, exitIfRoot } = require('../lib/privilege');

test('uid 0 is refused', () => { assert.match(rootRefusal(0), /root/); });
test('normal uid passes', () => { assert.equal(rootRefusal(1000), null); });
test('no getuid (Windows) passes', () => { assert.equal(rootRefusal(undefined), null); });

test('exitIfRoot exits 1 for root and is a no-op otherwise', () => {
  const codes = [];
  const errs = [];
  const fake = (uid) => ({ getuid: () => uid, exit: (c) => codes.push(c), stderr: { write: (s) => errs.push(s) } });
  exitIfRoot(fake(0));
  exitIfRoot(fake(501));
  exitIfRoot({ exit: (c) => codes.push(c), stderr: { write() {} } });
  assert.deepEqual(codes, [1]);
  assert.match(errs.join(''), /root/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/privilege.test.js`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement `lib/privilege.js`**

```js
/**
 * lib/privilege.js
 *
 * Refuse to run as root. Run under a dedicated unprivileged user or in the
 * Docker image (which uses pwuser).
 */

'use strict';

function rootRefusal(uid) {
  if (uid !== 0) return null;
  return 'Refusing to run as root. Create an unprivileged user (or use the Docker image) and run as that user.';
}

function exitIfRoot(proc) {
  const p = proc || process;
  const uid = typeof p.getuid === 'function' ? p.getuid() : undefined;
  const msg = rootRefusal(uid);
  if (msg) {
    p.stderr.write(msg + '\n');
    p.exit(1);
  }
}

module.exports = { rootRefusal, exitIfRoot };
```

- [ ] **Step 4: Wire callers**

`watcher.js`, directly after the last top-level `require(...)` line: `require('./lib/privilege').exitIfRoot();`
`setup.js`, first line inside `if (require.main === module) {`: `require('./lib/privilege').exitIfRoot();`
`dashboard/server.js`, first line inside `if (require.main === module) {`: `require('../lib/privilege').exitIfRoot();`

- [ ] **Step 5: Run tests**

Run: `node --test test/privilege.test.js test/cli-bin-smoke.test.js test/cli-dashboard-boot.test.js && node --check watcher.js`
Expected: PASS (tests run as a normal user).

- [ ] **Step 6: Commit**

```bash
git add lib/privilege.js test/privilege.test.js watcher.js setup.js dashboard/server.js
git commit -m "feat(fork): refuse to run watcher, setup and dashboard as root"
```

---

### Task 7: Dashboard is loopback-only and always authenticated (F5, F6)

**Files:**
- Modify: `dashboard/validate.js` (add `isLoopbackHost`, `dashboardStartupProblems`)
- Modify: `dashboard/validate.test.js` (append)
- Modify: `dashboard/server.js` (startup block; `POST /api/schedule`)
- Delete: `dashboard/examples/aidr-dashboard.service`, `dashboard/examples/aidr.service`
- Modify: `dashboard/README.md` (Run, Auth table `AIDR_HOST` row, Scheduling, Security notes)
- Modify: `SECURITY.md` (dashboard paragraph)

**Interfaces:**
- Produces (`dashboard/validate.js`):
  - `isLoopbackHost(host: string) -> boolean` - true for `localhost`, `::1`, `[::1]`, any IPv4 `127.x.y.z`
  - `dashboardStartupProblems({ host, authConfigured }) -> string[]` - empty when OK
- `POST /api/schedule` -> 501 `{ error: 'Schedule editing is disabled in this fork (it needs root). Use `aidr setup` to install the per-user systemd timer.' }`

- [ ] **Step 1: Write the failing test** (append to `dashboard/validate.test.js`, matching its import style; add the two names to its `require('./validate')` destructure)

```js
test('isLoopbackHost accepts loopback only', () => {
  for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]', 'LOCALHOST']) {
    assert.equal(isLoopbackHost(h), true, h);
  }
  for (const h of ['0.0.0.0', '::', '192.168.1.5', '10.0.0.1', 'example.com', '', '127.0.0.1.evil.com', '1270.0.0.1']) {
    assert.equal(isLoopbackHost(h), false, h);
  }
});

test('dashboardStartupProblems refuses non-loopback and missing auth', () => {
  assert.deepEqual(dashboardStartupProblems({ host: '127.0.0.1', authConfigured: true }), []);
  assert.equal(dashboardStartupProblems({ host: '0.0.0.0', authConfigured: true }).length, 1);
  assert.equal(dashboardStartupProblems({ host: '127.0.0.1', authConfigured: false }).length, 1);
  assert.equal(dashboardStartupProblems({ host: '0.0.0.0', authConfigured: false }).length, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test dashboard/validate.test.js`
Expected: FAIL - `isLoopbackHost is not a function`.

- [ ] **Step 3: Implement in `dashboard/validate.js`**

```js
// The dashboard serves PII and can trigger real submissions. This fork never
// binds it to anything but loopback; reach it remotely through `ssh -L`.
function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase();
  if (h === 'localhost' || h === '::1' || h === '[::1]') return true;
  const m = h.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return !!m && m.slice(1).every(o => Number(o) <= 255);
}

function dashboardStartupProblems({ host, authConfigured }) {
  const problems = [];
  if (!isLoopbackHost(host)) {
    problems.push(`AIDR_HOST=${host} is not a loopback address. This fork only binds 127.0.0.1/::1; use "ssh -L 8080:127.0.0.1:8080 host" for remote access.`);
  }
  if (!authConfigured) {
    problems.push('No credentials set. Start it with `aidr dashboard` (generates a one-time login) or set AIDR_USER and AIDR_PASS.');
  }
  return problems;
}
```

Add both to `module.exports`.

- [ ] **Step 4: Wire `dashboard/server.js`**

Add `isLoopbackHost, dashboardStartupProblems` to the `require('./validate')` destructure (line 46; `isLoopbackHost` may be unused there - only import what is used). Replace the `require.main` block:

```js
if (require.main === module) {
  require('../lib/privilege').exitIfRoot();
  const problems = dashboardStartupProblems({ host: HOST, authConfigured: authConfigured() });
  if (problems.length) {
    for (const p of problems) console.error(`aidr-dashboard: ${p}`);
    process.exit(1);
  }
  app.listen(PORT, HOST, () => {
    const c = loadCreds();
    const mode = [c ? `basic(${c.source})` : null, TOKEN ? 'token' : null].filter(Boolean).join('+');
    console.log(`aidr-dashboard listening on ${HOST}:${PORT} (root=${ROOT}, auth=${mode})`);
    if (c && c.source === 'broken') console.warn('WARNING: .auth.json is present but corrupt - all logins will fail until it is fixed or removed.');
  });
}
```

Replace the whole `app.post('/api/schedule', ...)` handler with:

```js
// Disabled in this fork: it wrote /etc/systemd/system, which needs the dashboard
// to run as root. `aidr setup` installs a per-user timer instead.
app.post('/api/schedule', (_req, res) => {
  res.status(501).json({ error: 'Schedule editing is disabled in this fork (it needs root). Use `aidr setup` to install the per-user systemd timer.' });
});
```

In `dashboard/public/app.js` `postSchedule` already surfaces API errors via `api()`; verify by `grep -n "async function api" -A12 dashboard/public/app.js` that a non-2xx shows the error text. If not, no change: the button simply fails and the GET status still renders.

- [ ] **Step 5: Delete root examples and fix docs**

```bash
git rm dashboard/examples/aidr-dashboard.service dashboard/examples/aidr.service
```

`dashboard/README.md`:
- `AIDR_HOST` table row -> `| AIDR_HOST | 127.0.0.1 | Bind address. Must be loopback (127.x, ::1, localhost); anything else refuses to start. For remote access use ssh -L. |`
- Under "Run", replace the code block with ``aidr dashboard`` (from the repo root) and one sentence: "It prints a one-time login. Running `node server.js` directly without `AIDR_USER`/`AIDR_PASS` refuses to start."
- Replace the "Scheduling" section body with: "Disabled in this fork: the old Schedule tab wrote `/etc/systemd/system` and required running the dashboard as root. `aidr setup` installs a per-user systemd timer (or crontab/launchd) instead. The tab still shows status read-only."
- In "Security notes", delete the `AIDR_HOST=0.0.0.0` sentence.
- In the unauthenticated paragraph under Auth, replace "If none of the three are set the dashboard runs **unauthenticated** ..." with "If none are set the dashboard refuses to start."

`SECURITY.md`: replace the "If you run the dashboard..." paragraph with: "Start the dashboard only with `aidr dashboard`. It refuses to bind anything but loopback and refuses to start without credentials. For remote access use `ssh -L 8080:127.0.0.1:8080 <host>`."

- [ ] **Step 6: Run tests**

Run: `node --test dashboard/validate.test.js test/cli-dashboard-boot.test.js test/docs-commands.test.js && (cd dashboard && node --test)`
Expected: PASS. If `dashboard/server.test.js` asserts a 200 for `POST /api/schedule`, change that expectation to 501 (the route is still auth-gated; keep the 401-without-auth assertion). If `test/docs-commands.test.js` fails on a now-removed doc command, update the doc, not the test.

- [ ] **Step 7: Commit**

```bash
git add -A dashboard SECURITY.md
git commit -m "fix(dashboard): loopback-only, refuse to start unauthenticated, drop root-only schedule writes and root example units"
```

---

### Task 8: Permissions script, Docker hardening, club docs (F11, decisions 8-9)

**Files:**
- Create: `scripts/harden.sh`
- Test: `test/harden-script.test.js`
- Modify: `docker-compose.yml`
- Modify: `test/docker-build-contract.test.js` (append compose assertions)
- Modify: `FORK.md` (full member checklist)
- Modify: `README.md` (fork banner at top linking `FORK.md`)

**Interfaces:**
- Produces: `bash scripts/harden.sh` - exit 0 when permissions applied and verified; exit 2 when chmod is ineffective (DrvFs / FAT / some network mounts); exit 1 when run as root. Applies `chmod 700` to repo root, `logs/`, `data/`, profile dir `~/.config/auto-identity-remove`; `chmod 600` to `config.json config.json.enc state.json state.json.* dashboard/.auth.json ~/.config/auto-identity-remove/passphrase` that exist.

- [ ] **Step 1: Write the failing test**

`test/harden-script.test.js`:

```js
/**
 * test/harden-script.test.js
 *
 * scripts/harden.sh must refuse root, set owner-only modes, and detect a
 * filesystem where chmod silently does nothing (WSL /mnt/c, FAT, SMB).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'harden.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

test('harden.sh parses', () => { execFileSync('bash', ['-n', SCRIPT]); });
test('harden.sh refuses root', () => { assert.match(SRC, /id -u/); });
test('harden.sh probes that chmod actually took effect', () => { assert.match(SRC, /stat/); assert.match(SRC, /exit 2/); });
test('harden.sh covers the PII files', () => {
  for (const f of ['config.json', 'config.json.enc', 'state.json', '.auth.json', 'passphrase']) {
    assert.ok(SRC.includes(f), f);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/harden-script.test.js`
Expected: FAIL - ENOENT.

- [ ] **Step 3: Implement `scripts/harden.sh`**

```bash
#!/usr/bin/env bash
# scripts/harden.sh - make every file that can hold PII or secrets owner-only.
#
# Usage: bash scripts/harden.sh
# Exit: 0 ok, 1 run as root, 2 this filesystem ignores chmod (move the repo).
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
REPO="$(pwd)"

if [ "$(id -u)" = "0" ]; then
  echo "Do not run as root. Run as the unprivileged user that will run the tool." >&2
  exit 1
fi

mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# Probe: does chmod work here? On WSL /mnt/<drive> (DrvFs without the metadata
# mount option), FAT and many SMB mounts it silently does nothing and every
# file stays readable by everyone.
probe="$(mktemp "$REPO/.harden-probe.XXXXXX")"
chmod 600 "$probe"
probe_mode="$(mode_of "$probe")"
rm -f "$probe"
if [ "$probe_mode" != "600" ]; then
  echo "chmod has no effect on $REPO (mode came back $probe_mode)." >&2
  case "$REPO" in
    /mnt/[a-z]/*) echo "This is a Windows drive under WSL. Move the repo into your Linux home, e.g.:" >&2
                  echo "  git clone \"$REPO\" ~/auto-identity-remove" >&2 ;;
    *)            echo "Move the repo to a local Linux/macOS filesystem." >&2 ;;
  esac
  exit 2
fi

PROFILE="${HOME}/.config/auto-identity-remove"
chmod 700 "$REPO"
for d in logs data "$PROFILE"; do
  [ -d "$d" ] && chmod 700 "$d"
done
for f in config.json config.json.enc state.json state.json.bak state.json.checkpoint \
         dashboard/.auth.json "$PROFILE/passphrase"; do
  [ -e "$f" ] && chmod 600 "$f"
done
find logs -type f -exec chmod 600 {} + 2>/dev/null || true

echo "Permissions hardened under $REPO (dirs 700, PII files 600)."
```

`chmod +x scripts/harden.sh`.

- [ ] **Step 4: Docker compose hardening**

Edit `docker-compose.yml` service `watcher` - add:

```yaml
    user: pwuser
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    secrets:
      - aidr-passphrase
```

and in `environment:` add `- AIDR_PASSPHRASE_FILE=/run/secrets/aidr-passphrase`. At file end:

```yaml
secrets:
  aidr-passphrase:
    # chmod 600 this file on the host. Remove this block and the service's
    # `secrets:` / AIDR_PASSPHRASE_FILE lines if you do not encrypt the config.
    file: ./secrets/aidr-passphrase
```

Add `secrets/` to both `.gitignore` and `.dockerignore`.

Note: compose file secrets are bind mounts, so the host file's mode carries in, and `readPassphraseFile` will refuse it if it is group/world-readable. That is intended; FORK.md tells members to `chmod 600`. The file must be owned by uid 1001 (pwuser) or be readable by it: document `sudo chown 1001 secrets/aidr-passphrase` as the alternative to running the container as the host uid.

Append to `test/docker-build-contract.test.js`:

```js
test('docker-compose.yml drops capabilities and blocks privilege escalation', () => {
  assert.match(compose, /cap_drop:\s*\[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /AIDR_PASSPHRASE_FILE=\/run\/secrets\/aidr-passphrase/);
  assert.doesNotMatch(compose, /AIDR_PASSPHRASE=/);
});
```

**Manual verification required on a Docker host** (none here): `docker compose build && docker compose run --rm watcher node watcher.js --doctor`. Then confirm Chromium still launches with `cap_drop: [ALL]`: `docker compose run --rm watcher node watcher.js --dry-run --only Spokeo`. Chromium's own sandbox needs user namespaces, which `cap_drop: [ALL]` can block. If launch fails, check what `buildLaunchOptions` passes in Docker (`grep -n "sandbox" lib/browser.js`). Do **not** add `SYS_ADMIN` back. Record the outcome in FORK.md under a "Docker verification" heading.

- [ ] **Step 5: FORK.md pointer**

Append to `FORK.md`:

```markdown
## Setting it up

Follow [docs/UPEC-MANUAL.md](docs/UPEC-MANUAL.md). Read
[docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) to know what it does and does not protect.
```

(Both docs are written in Task 13.)

`README.md`: insert directly under the `# auto-identity-remove` heading:

```markdown
> **UPEC hardened fork.** Defaults differ from upstream: SimpleLogin relay required
> and fail-closed, generic pass off, never runs as root, dashboard loopback-only.
> Start with [docs/UPEC-MANUAL.md](docs/UPEC-MANUAL.md).
```

- [ ] **Step 6: Run tests**

Run: `chmod +x scripts/harden.sh && node --test test/harden-script.test.js test/docker-build-contract.test.js test/docs-commands.test.js`
Expected: PASS.

Run it here to confirm the DrvFs detection works on this checkout: `bash scripts/harden.sh; echo "exit=$?"`
Expected: `exit=2` with the WSL message (the repo is on `/mnt/c`).

- [ ] **Step 7: Commit**

```bash
git add scripts/harden.sh test/harden-script.test.js docker-compose.yml test/docker-build-contract.test.js .gitignore .dockerignore FORK.md README.md
git commit -m "feat(fork): harden.sh permission script, Docker cap_drop + passphrase secret, member setup guide"
```

---

### Task 9: Egress check module - fail closed unless traffic leaves via VPN/proxy (decision 10)

**Files:**
- Create: `lib/egress.js`
- Test: `test/egress.test.js`
- Modify: `config.example.json` (add `network` block)

**Interfaces:**
- Produces (`lib/egress.js`):
  - `MULLVAD_CHECK_URL = 'https://am.i.mullvad.net/json'`, `IP_ECHO_URL = 'https://api.ipify.org?format=json'`
  - `egressRequired(config) -> boolean` - `config?.network?.required !== false`
  - `proxyFromConfig(config) -> { server: string } | null` - throws `Error(/network.proxy/)` for a scheme other than `socks5:`, `http:`, `https:` or an unparsable URL
  - `checkEgress({ config, fetchJsonInBrowser, fetchJsonDirect }) -> Promise<{ ok: boolean, mode: 'mullvad'|'proxy'|'skipped', detail: string }>` - never throws; any error -> `ok: false`
  - `fetchJsonViaPage(context, url, timeoutMs = 20000) -> Promise<object>` - opens a page, `goto`, parses `JSON.parse(await response.text())`, always closes the page

- [ ] **Step 1: Write the failing test**

`test/egress.test.js`:

```js
/**
 * test/egress.test.js
 *
 * Brokers and search engines must not see the member's home IP. The check runs
 * through the browser itself and fails closed on anything unexpected.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  egressRequired, proxyFromConfig, checkEgress, fetchJsonViaPage, MULLVAD_CHECK_URL, IP_ECHO_URL,
} = require('../lib/egress');

const never = async () => { throw new Error('should not be called'); };

test('egress is required by default and only disabled by an explicit false', () => {
  assert.equal(egressRequired({}), true);
  assert.equal(egressRequired({ network: {} }), true);
  assert.equal(egressRequired({ network: { required: 'false' } }), true);
  assert.equal(egressRequired({ network: { required: false } }), false);
});

test('proxyFromConfig accepts socks5/http/https and rejects others', () => {
  assert.equal(proxyFromConfig({}), null);
  assert.equal(proxyFromConfig({ network: { proxy: '' } }), null);
  assert.deepEqual(proxyFromConfig({ network: { proxy: 'socks5://10.64.0.1:1080' } }), { server: 'socks5://10.64.0.1:1080' });
  assert.deepEqual(proxyFromConfig({ network: { proxy: 'http://127.0.0.1:8118' } }), { server: 'http://127.0.0.1:8118' });
  assert.throws(() => proxyFromConfig({ network: { proxy: 'ftp://x:1' } }), /network\.proxy/);
  assert.throws(() => proxyFromConfig({ network: { proxy: 'not a url' } }), /network\.proxy/);
});

test('mullvad mode: ok only when mullvad_exit_ip === true', async () => {
  const seen = [];
  const yes = await checkEgress({ config: {}, fetchJsonInBrowser: async (u) => { seen.push(u); return { ip: '1.2.3.4', mullvad_exit_ip: true }; }, fetchJsonDirect: never });
  assert.equal(yes.ok, true);
  assert.equal(yes.mode, 'mullvad');
  assert.deepEqual(seen, [MULLVAD_CHECK_URL]);
  const no = await checkEgress({ config: {}, fetchJsonInBrowser: async () => ({ ip: '1.2.3.4', mullvad_exit_ip: false }), fetchJsonDirect: never });
  assert.equal(no.ok, false);
  assert.match(no.detail, /Mullvad/);
  const truthy = await checkEgress({ config: {}, fetchJsonInBrowser: async () => ({ mullvad_exit_ip: 'true' }), fetchJsonDirect: never });
  assert.equal(truthy.ok, false, 'string "true" is not accepted');
});

test('mullvad mode: network error or garbage fails closed', async () => {
  const err = await checkEgress({ config: {}, fetchJsonInBrowser: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); }, fetchJsonDirect: never });
  assert.equal(err.ok, false);
  assert.match(err.detail, /ERR_NAME_NOT_RESOLVED/);
  const junk = await checkEgress({ config: {}, fetchJsonInBrowser: async () => null, fetchJsonDirect: never });
  assert.equal(junk.ok, false);
});

test('proxy mode: ok only when browser IP differs from direct IP', async () => {
  const cfg = { network: { proxy: 'socks5://10.64.0.1:1080' } };
  const seen = [];
  const ok = await checkEgress({
    config: cfg,
    fetchJsonInBrowser: async (u) => { seen.push(['b', u]); return { ip: '185.65.1.1' }; },
    fetchJsonDirect: async (u) => { seen.push(['d', u]); return { ip: '73.10.10.10' }; },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, 'proxy');
  assert.deepEqual(seen, [['b', IP_ECHO_URL], ['d', IP_ECHO_URL]]);
  const same = await checkEgress({ config: cfg, fetchJsonInBrowser: async () => ({ ip: '73.10.10.10' }), fetchJsonDirect: async () => ({ ip: '73.10.10.10' }) });
  assert.equal(same.ok, false);
  assert.ok(!same.detail.includes('73.10.10.10'), 'never print the home IP');
  const missing = await checkEgress({ config: cfg, fetchJsonInBrowser: async () => ({}), fetchJsonDirect: async () => ({ ip: '1.1.1.1' }) });
  assert.equal(missing.ok, false);
  const directDown = await checkEgress({ config: cfg, fetchJsonInBrowser: async () => ({ ip: '185.65.1.1' }), fetchJsonDirect: async () => { throw new Error('offline'); } });
  assert.equal(directDown.ok, false);
});

test('network.required false skips the check', async () => {
  const r = await checkEgress({ config: { network: { required: false } }, fetchJsonInBrowser: never, fetchJsonDirect: never });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'skipped');
});

test('invalid proxy config fails closed instead of throwing', async () => {
  const r = await checkEgress({ config: { network: { proxy: 'ftp://x:1' } }, fetchJsonInBrowser: never, fetchJsonDirect: never });
  assert.equal(r.ok, false);
  assert.match(r.detail, /network\.proxy/);
});

test('fetchJsonViaPage parses the body and always closes the page', async () => {
  let closed = 0;
  const mkCtx = (text, gotoThrows) => ({
    newPage: async () => ({
      goto: async () => { if (gotoThrows) throw new Error('boom'); return { text: async () => text }; },
      close: async () => { closed += 1; },
    }),
  });
  assert.deepEqual(await fetchJsonViaPage(mkCtx('{"ip":"1.2.3.4"}'), IP_ECHO_URL), { ip: '1.2.3.4' });
  await assert.rejects(() => fetchJsonViaPage(mkCtx('<html>'), IP_ECHO_URL));
  await assert.rejects(() => fetchJsonViaPage(mkCtx('', true), IP_ECHO_URL), /boom/);
  assert.equal(closed, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/egress.test.js`
Expected: FAIL - `Cannot find module '../lib/egress'`.

- [ ] **Step 3: Implement `lib/egress.js`**

```js
/**
 * lib/egress.js
 *
 * Fail-closed check that browser traffic leaves through a VPN or proxy, so
 * brokers and search engines never see the member's home IP (which geolocates
 * to roughly the address being removed).
 *
 * - No network.proxy: the browser loads am.i.mullvad.net and must be on a
 *   Mullvad exit (Mullvad app, or Mullvad SOCKS5 configured system-wide).
 * - network.proxy set: Chromium uses that proxy, and the browser's public IP
 *   must differ from the machine's direct IP.
 * Anything unexpected is a failure. The home IP is never printed.
 */

'use strict';

const MULLVAD_CHECK_URL = 'https://am.i.mullvad.net/json';
const IP_ECHO_URL = 'https://api.ipify.org?format=json';
const PROXY_SCHEMES = ['socks5:', 'http:', 'https:'];

function egressRequired(config) {
  return !(config && config.network && config.network.required === false);
}

function proxyFromConfig(config) {
  const raw = config && config.network && typeof config.network.proxy === 'string' ? config.network.proxy.trim() : '';
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch (_) { throw new Error(`network.proxy is not a valid URL: ${raw}`); }
  if (!PROXY_SCHEMES.includes(u.protocol)) {
    throw new Error(`network.proxy must start with socks5://, http:// or https:// (got ${u.protocol})`);
  }
  return { server: raw };
}

async function checkEgress({ config, fetchJsonInBrowser, fetchJsonDirect }) {
  if (!egressRequired(config)) {
    return { ok: true, mode: 'skipped', detail: 'network.required is false - brokers may see your real IP' };
  }
  let proxy;
  try { proxy = proxyFromConfig(config); } catch (err) { return { ok: false, mode: 'proxy', detail: err.message }; }

  if (!proxy) {
    try {
      const j = await fetchJsonInBrowser(MULLVAD_CHECK_URL);
      if (j && j.mullvad_exit_ip === true) return { ok: true, mode: 'mullvad', detail: `Mullvad exit (${j.country || 'unknown country'})` };
      return { ok: false, mode: 'mullvad', detail: 'Not connected through Mullvad. Connect the Mullvad app (with Lockdown mode on), or set network.proxy.' };
    } catch (err) {
      return { ok: false, mode: 'mullvad', detail: `Could not reach the Mullvad check page: ${err.message}` };
    }
  }

  try {
    const viaBrowser = await fetchJsonInBrowser(IP_ECHO_URL);
    const direct = await fetchJsonDirect(IP_ECHO_URL);
    const b = viaBrowser && typeof viaBrowser.ip === 'string' ? viaBrowser.ip : '';
    const d = direct && typeof direct.ip === 'string' ? direct.ip : '';
    if (!b || !d) return { ok: false, mode: 'proxy', detail: 'Could not determine both the proxied and the direct IP.' };
    if (b === d) return { ok: false, mode: 'proxy', detail: 'The browser exits from the same IP as this machine: network.proxy is not being used.' };
    return { ok: true, mode: 'proxy', detail: 'Browser traffic exits through the configured proxy.' };
  } catch (err) {
    return { ok: false, mode: 'proxy', detail: `Egress check failed: ${err.message}` };
  }
}

async function fetchJsonViaPage(context, url, timeoutMs) {
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { timeout: timeoutMs || 20000, waitUntil: 'domcontentloaded' });
    return JSON.parse(await res.text());
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { egressRequired, proxyFromConfig, checkEgress, fetchJsonViaPage, MULLVAD_CHECK_URL, IP_ECHO_URL };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/egress.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: `config.example.json`**

Add before `"profileDir"`:

```json
  "network": {
    "_comment": "Fork default: required. Before visiting any broker the browser must be on a Mullvad exit (am.i.mullvad.net). Using a different VPN or proxy? Set proxy (e.g. socks5://10.64.0.1:1080) and the check becomes 'browser IP differs from direct IP'. required: false disables the check (not recommended).",
    "required": true,
    "proxy": ""
  },
```

- [ ] **Step 6: Commit**

```bash
git add lib/egress.js test/egress.test.js config.example.json
git commit -m "feat(egress): fail-closed VPN/proxy check (Mullvad exit or proxied IP differs)"
```

---

### Task 10: Browser session - ephemeral profile, proxy, egress check at every launch (decisions 10-11)

**Files:**
- Create: `lib/browser-session.js`
- Test: `test/browser-session.test.js`
- Modify: `lib/browser.js` (`buildLaunchOptions` accepts `proxy`)
- Modify: `test/browser-launch.test.js` (append)
- Modify: `watcher.js` (the four `launchPersistentContext` sites: ~408 complaints PDF, ~460 confirm-emails, ~544 report, ~776 main run; `profileDir` consts ~406, ~444, ~511, ~648)

**Interfaces:**
- Consumes: `proxyFromConfig`, `checkEgress`, `fetchJsonViaPage` (Task 9); `buildLaunchOptions` (lib/browser.js).
- Produces:
  - `buildLaunchOptions({ ..., proxy })` - when `proxy` is `{ server }`, result has `proxy` and args include `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
  - `acquireProfileDir(config, { mkdtemp, rm, homedir } = {}) -> { dir: string, ephemeral: boolean, cleanup: () => void }`
  - `openBrowserSession({ chromium, config, headless, needsNetwork = true, fetchJsonDirect? }) -> Promise<{ context, close: () => Promise<void> }>` - throws `EgressError` (exported, `name === 'EgressError'`) after closing the browser and deleting the profile when the check fails
  - `withBrowserSession(opts, fn) -> Promise<any>` - opens, runs `fn(context)`, always `close()`s

- [ ] **Step 1: Write the failing tests**

Append to `test/browser-launch.test.js` (use its existing `buildLaunchOptions` import):

```js
test('buildLaunchOptions passes a proxy and blocks non-proxied WebRTC', () => {
  const o = buildLaunchOptions({ headless: true, platform: 'linux', env: {}, proxy: { server: 'socks5://10.64.0.1:1080' } });
  assert.deepEqual(o.proxy, { server: 'socks5://10.64.0.1:1080' });
  assert.ok(o.args.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'));
});

test('buildLaunchOptions without proxy has no proxy key', () => {
  const o = buildLaunchOptions({ headless: true, platform: 'linux', env: {} });
  assert.equal('proxy' in o, false);
});
```

Create `test/browser-session.test.js`:

```js
/**
 * test/browser-session.test.js
 *
 * Every browser launch uses a throwaway profile (unless opted out), the
 * configured proxy, and the egress check. Failure or a crash in the caller must
 * still close the browser and delete the profile.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { acquireProfileDir, openBrowserSession, withBrowserSession, EgressError } = require('../lib/browser-session');

function fakeChromium(json) {
  const calls = { launches: [], closed: 0 };
  return {
    calls,
    launchPersistentContext: async (dir, opts) => {
      calls.launches.push({ dir, opts });
      return {
        newPage: async () => ({ goto: async () => ({ text: async () => JSON.stringify(json) }), close: async () => {} }),
        close: async () => { calls.closed += 1; },
      };
    },
  };
}

test('default profile is a fresh 0700 temp dir that cleanup removes', () => {
  const p = acquireProfileDir({});
  assert.equal(p.ephemeral, true);
  assert.ok(p.dir.startsWith(os.tmpdir()));
  if (process.platform !== 'win32') assert.equal(fs.statSync(p.dir).mode & 0o777, 0o700);
  p.cleanup();
  assert.equal(fs.existsSync(p.dir), false);
});

test('browser.persistentProfile true uses profileDir and never deletes it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-keep-'));
  const p = acquireProfileDir({ browser: { persistentProfile: true }, profileDir: dir });
  assert.equal(p.ephemeral, false);
  assert.equal(p.dir, dir);
  p.cleanup();
  assert.equal(fs.existsSync(dir), true);
});

test('passing egress check yields a context; close removes the profile', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: true, country: 'Sweden' });
  const s = await openBrowserSession({ chromium, config: {}, headless: true });
  const dir = chromium.calls.launches[0].dir;
  assert.ok(fs.existsSync(dir));
  await s.close();
  assert.equal(chromium.calls.closed, 1);
  assert.equal(fs.existsSync(dir), false);
});

test('failing egress check throws EgressError, closes the browser and removes the profile', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: false });
  await assert.rejects(() => openBrowserSession({ chromium, config: {}, headless: true }), EgressError);
  assert.equal(chromium.calls.closed, 1);
  assert.equal(fs.existsSync(chromium.calls.launches[0].dir), false);
});

test('proxy from config reaches the launch options', async () => {
  const chromium = fakeChromium({ ip: '185.65.1.1' });
  const s = await openBrowserSession({
    chromium, config: { network: { proxy: 'socks5://10.64.0.1:1080' } }, headless: true,
    fetchJsonDirect: async () => ({ ip: '73.1.1.1' }),
  });
  assert.deepEqual(chromium.calls.launches[0].opts.proxy, { server: 'socks5://10.64.0.1:1080' });
  await s.close();
});

test('needsNetwork false skips the check (local PDF rendering)', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: false });
  const s = await openBrowserSession({ chromium, config: {}, headless: true, needsNetwork: false });
  await s.close();
});

test('withBrowserSession cleans up when the body throws', async () => {
  const chromium = fakeChromium({ mullvad_exit_ip: true });
  await assert.rejects(() => withBrowserSession({ chromium, config: {}, headless: true }, async () => { throw new Error('crash'); }), /crash/);
  assert.equal(chromium.calls.closed, 1);
  assert.equal(fs.existsSync(chromium.calls.launches[0].dir), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/browser-launch.test.js test/browser-session.test.js`
Expected: FAIL - no `proxy` key; module not found.

- [ ] **Step 3: `lib/browser.js`**

In `buildLaunchOptions`:

```js
function buildLaunchOptions(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const extraArgs = [...(opts.extraArgs || [])];
  // With a proxy, stop WebRTC from sending UDP outside it (it would reveal the
  // real IP to any page that asks).
  if (opts.proxy) extraArgs.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  const out = {
    headless: opts.headless !== undefined ? !!opts.headless : resolveHeadless(env, platform),
    viewport: opts.viewport || { ...VIEWPORT },
    args: buildLaunchArgs({ platform, lowMemory: opts.lowMemory, env, extraArgs }),
    ignoreDefaultArgs: ['--enable-automation'],
  };
  if (opts.proxy) out.proxy = { ...opts.proxy };
  return out;
}
```

- [ ] **Step 4: Implement `lib/browser-session.js`**

```js
/**
 * lib/browser-session.js
 *
 * One way to open the browser for this fork:
 * - a throwaway profile per launch (cookies and fingerprint state from broker
 *   sites do not accumulate across runs) unless browser.persistentProfile is true;
 * - the configured network.proxy;
 * - the fail-closed egress check before the caller gets the context.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLaunchOptions } = require('./browser');
const { proxyFromConfig, checkEgress, fetchJsonViaPage } = require('./egress');

class EgressError extends Error {
  constructor(message) { super(message); this.name = 'EgressError'; }
}

function acquireProfileDir(config) {
  const persistent = !!(config && config.browser && config.browser.persistentProfile === true);
  if (persistent) {
    const dir = ((config && config.profileDir) || '~/.config/auto-identity-remove').replace(/^~(?=\/|$)/, os.homedir());
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { dir, ephemeral: false, cleanup: () => {} };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidr-profile-'));
  fs.chmodSync(dir, 0o700);
  return { dir, ephemeral: true, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function defaultFetchJsonDirect(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return res.json();
}

async function openBrowserSession({ chromium, config, headless, needsNetwork = true, fetchJsonDirect }) {
  const profile = acquireProfileDir(config);
  let proxy = null;
  try { proxy = proxyFromConfig(config); } catch (err) { profile.cleanup(); throw new EgressError(err.message); }

  let context;
  try {
    context = await chromium.launchPersistentContext(profile.dir, buildLaunchOptions({ headless, proxy: proxy || undefined }));
  } catch (err) {
    profile.cleanup();
    throw err;
  }
  const close = async () => {
    await context.close().catch(() => {});
    profile.cleanup();
  };

  if (needsNetwork) {
    const r = await checkEgress({
      config,
      fetchJsonInBrowser: (url) => fetchJsonViaPage(context, url),
      fetchJsonDirect: fetchJsonDirect || defaultFetchJsonDirect,
    });
    if (!r.ok) {
      await close();
      throw new EgressError(`Network check failed - nothing was submitted. ${r.detail}`);
    }
    console.log(`🛡  Network: ${r.detail}`);
  }
  return { context, close };
}

async function withBrowserSession(opts, fn) {
  const s = await openBrowserSession(opts);
  try {
    return await fn(s.context);
  } finally {
    await s.close();
  }
}

module.exports = { acquireProfileDir, openBrowserSession, withBrowserSession, EgressError };
```

- [ ] **Step 5: Run unit tests**

Run: `node --test test/browser-launch.test.js test/browser-session.test.js`
Expected: PASS.

- [ ] **Step 6: Wire the four launch sites in `watcher.js`**

Add near the other requires: `const { openBrowserSession, EgressError } = require('./lib/browser-session');`

For each site, replace the `profileDir... .replace(...)` const and the `launchPersistentContext(...)` call with `openBrowserSession`, keep the variable name the surrounding code uses for the context, and replace that site's `context.close()` calls with the session's `close()`:

- Complaints PDF (~406-408): local HTML only -> `needsNetwork: false`:
  ```js
      const session = await openBrowserSession({ chromium: chromiumForPdf, config, headless: true, needsNetwork: false });
      context = session.context;
  ```
  and where that block later closes `context`, call `await session.close()` (declare `let session = null;` next to `let context` and guard `if (session) await session.close();`).
- Confirm-emails (~444-460): visits broker links -> `needsNetwork: true` (default). `const { context, close } = await openBrowserSession({ chromium: chromiumForConfirm, config: loadConfig(), headless: true });` and replace its `context.close()` with `close()`.
- Report (~511-544): renders local HTML to PDF -> `needsNetwork: false`. Same pattern.
- Main run (~767-776): delete `fs.mkdirSync(profileDir, { recursive: true });`, then:
  ```js
  let session;
  try {
    session = await openBrowserSession({ chromium, config, headless });
  } catch (err) {
    if (err instanceof EgressError) { console.error(`⛔ ${err.message}`); process.exitCode = 1; return; }
    throw err;
  }
  const context = session.context;
  ```
  Then `grep -n "context.close()" watcher.js` and replace every close of the main-run context (verify, serp-scan, end of run, Task 2's early return) with `await session.close();`. Remove the now-unused module-level `profileDir` const (~648) if `grep -n "profileDir" watcher.js` shows no remaining use; do not remove `config.profileDir` handling inside `lib/browser-session.js`.

Ensure the top-level `.catch` / crash handler around `main()` still runs: an `EgressError` from the confirm site should print the message and exit 1, matching the main-run handling.

- [ ] **Step 7: Verify**

Run: `node --check watcher.js && grep -n "launchPersistentContext" watcher.js` - expect no output from grep.
Run: `npm test 2>&1 | tail -8` - expect `fail 0`.

Manual (needs Mullvad connected, real config, submits nothing): `node watcher.js --dry-run --only Spokeo` - expect `🛡  Network: Mullvad exit (...)`. Disconnect Mullvad, re-run - expect `⛔ Network check failed - nothing was submitted` and exit 1. Record both outputs in the task report.

- [ ] **Step 8: Commit**

```bash
git add lib/browser.js lib/browser-session.js test/browser-launch.test.js test/browser-session.test.js watcher.js
git commit -m "feat(browser): ephemeral profile, proxy support and fail-closed egress check on every launch"
```

---

### Task 11: Remove all notifications (decision 12)

**Files:**
- Modify: `lib/notify.js` (keep only `openInBrowser` and whatever it needs)
- Modify: `watcher.js` (line 17 import; ~552-583 report email + toast; ~1061-1067 sendText/desktopNotify; `const { notify } = config;` ~647)
- Modify: `lib/serp-watch.js` (drop `dispatchNotify`; keep diff + history)
- Modify: `setup.js` (~219 iMessage prompt, webhook prompt, ~279 `notify:` key)
- Modify: `dashboard/public/app.js` (~516, ~537, ~664-665 notify fields), `dashboard/server.js` (~426 `webhook:` summary flag)
- Modify: `config.example.json` (delete `notify` block)
- Modify: `lib/doctor.js` if it checks notify (`grep -n notify lib/doctor.js`)
- Modify/delete tests: `test/notify.test.js`, `test/notify-cross-platform.test.js`, `test/serp-watch.test.js`, any `test/*` grep hit for `sendText|desktopNotify|dispatchNotify|webhook|textTo|emailReportTo`
- Create: `test/no-notifications.test.js`
- Modify: `README.md` (delete the "Webhook notifications" section and iMessage mentions in "What it does" and the setup table)

**Interfaces:**
- Produces: `lib/notify.js` exports exactly `{ openInBrowser }`. `lib/serp-watch.js` main function keeps its signature and return value; `opts._dispatchNotify` is ignored. `watcher.js` prints `ℹ  notify settings in config.json are ignored in this fork.` once when `config.notify` exists.

- [ ] **Step 1: Write the failing guard test**

`test/no-notifications.test.js`:

```js
/**
 * test/no-notifications.test.js
 *
 * Fork decision: results never leave the machine as a notification (no
 * iMessage, desktop toast, webhook or emailed report).
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['watcher.js', 'setup.js', 'lib/notify.js', 'lib/serp-watch.js', 'lib/report.js', 'dashboard/server.js', 'dashboard/public/app.js'];

test('lib/notify.js only exports openInBrowser', () => {
  assert.deepEqual(Object.keys(require('../lib/notify')).sort(), ['openInBrowser']);
});

test('no source references a notification channel', () => {
  for (const rel of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const word of ['sendText', 'desktopNotify', 'macNotify', 'dispatchNotify', '_webhookPost', 'emailReportTo', 'osascript', 'notify-send', 'textTo']) {
      assert.ok(!src.includes(word), `${rel} still references ${word}`);
    }
  }
});

test('config.example.json has no notify block', () => {
  assert.equal('notify' in require('../config.example.json'), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/no-notifications.test.js`
Expected: FAIL on all three.

- [ ] **Step 3: Strip `lib/notify.js`**

Keep the module header (rewritten to: "Opens manual-action URLs in the local browser. Notifications were removed in this fork: nothing about a run leaves the machine."), `openInBrowser` and any helper it calls. Delete `sendText`, `macNotify`, `desktopNotify`, `_webhookPost`, `dispatchNotify` and their exports. If `osascript` appears in `openInBrowser` itself, leave that function untouched and drop `'osascript'` from the guard test's word list.

- [ ] **Step 4: Callers**

- `watcher.js` line 17 -> `const { openInBrowser } = require('./lib/notify');`
- Delete the `sendText(...)` and `desktopNotify(...)` lines (~1061-1067) and the report toast (~583). Delete the whole `if (smtp && reportConfig.notify && reportConfig.notify.emailReportTo) { ... }` block (~552-575); the report is still written to disk and its path printed.
- Replace `const { notify } = config;` with:
  ```js
  if (config.notify) console.log('ℹ  notify settings in config.json are ignored in this fork.');
  ```
  and fix any remaining `notify` references (`grep -n "\bnotify\b" watcher.js`).
- `lib/serp-watch.js`: remove `const notify = require('./notify');`, the `dispatchFn` line and its call; keep printing the new domains to stdout and writing history. Update its header comment.
- `setup.js`: remove the iMessage and webhook prompts and the `notify:` key in the written config.
- `dashboard/public/app.js`: remove `'notify.webhook'` from `WIZ_SECRET_PATHS`, the `'notify.textTo'` placeholder, and the two `add(...)` lines. `dashboard/server.js` ~426: remove the `webhook:` summary flag. Leave `maskConfig` as is so an old config that still has `notify.webhook` is masked, not exposed (the guard test does not scan for `webhook` in server.js).
- `lib/report.js`, `lib/doctor.js`: remove notify checks if any.

- [ ] **Step 5: Tests and docs**

Delete `test/notify.test.js` and `test/notify-cross-platform.test.js` if every test in them targets a removed function; otherwise keep only the `openInBrowser` tests. In `test/serp-watch.test.js`, change assertions about `_dispatchNotify` being called into assertions about the returned/printed new domains. Grep for the rest: `grep -rln "sendText\|desktopNotify\|dispatchNotify\|textTo\|emailReportTo" test dashboard/*.test.js` and fix each hit (dashboard `server.test.js` webhook-masking tests stay: they test masking of legacy keys).

README: remove the "Webhook notifications (any OS)" subsection, step 6 "Sends you an iMessage" in "What it does", the "iMessage" row in the setup table, and the `notify` mention in "Continuous SERP monitoring" (now: "prints new domains and records them in data/serp-history.json").

- [ ] **Step 6: Run tests**

Run: `node --test test/no-notifications.test.js test/serp-watch.test.js && npm test 2>&1 | tail -8 && (cd dashboard && node --test 2>&1 | tail -5)`
Expected: PASS, `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add -A lib watcher.js setup.js dashboard config.example.json test README.md
git commit -m "feat(fork): remove iMessage, desktop, webhook and emailed-report notifications"
```

---

### Task 12: Dependencies - audit, nodemailer 10, exact pins, CI gate (F10)

**Files:**
- Modify: `package.json`, `package-lock.json`, `dashboard/package.json`, `dashboard/package-lock.json`
- Modify: `.github/workflows/test.yml`

**Interfaces:**
- Produces: `npm audit --audit-level=high` exits 0 in both manifests; direct deps are exact versions (no `^`/`~`).

- [ ] **Step 1: Baseline**

Run: `npm audit --audit-level=high; echo $?; (cd dashboard && npm audit --audit-level=high; echo $?)`
Expected: non-zero in both (3 high root; 1 critical dashboard).

- [ ] **Step 2: Non-breaking fixes**

```bash
npm audit fix
(cd dashboard && npm audit fix)
git diff --stat package-lock.json dashboard/package-lock.json
```

Read the lockfile diff: only `axios`, `form-data`, `express`, `qs`, `proxy-addr` and their transitive deps should move.

- [ ] **Step 3: nodemailer major bump**

```bash
npm view nodemailer@10 version engines
npm install --save-optional --save-exact nodemailer@10
```

Check `engines.node` from the `npm view` output is satisfied by `>=18`; if nodemailer 10 needs a newer Node, raise `engines.node` in `package.json` and drop that Node version from the CI matrix. Read nodemailer's CHANGELOG entries for 9.0.0 and 10.0.0 (`npm view nodemailer@10 repository.url`, then the CHANGELOG.md there) for changes to `createTransport({host,port,secure,auth})` or `sendMail({from,to,subject,text,replyTo})` - the only APIs used (`grep -rn "nodemailer" lib`). Note any breaking change and adjust callers.

- [ ] **Step 4: Exact pins**

Edit `package.json`: `"axios": "<installed version>"`, `"playwright": "1.60.0"` (already exact), `"nodemailer": "<installed>"`. Edit `dashboard/package.json`: `"express": "<installed>"`. Get installed versions with `npm ls axios nodemailer --depth=0` and `(cd dashboard && npm ls express --depth=0)`. Run `npm install` and `(cd dashboard && npm install)` so lockfiles match.

- [ ] **Step 5: CI gate** - in `.github/workflows/test.yml`, `test` job, after "Install dashboard dependencies":

```yaml
      - name: Audit dependencies (fail on high/critical)
        run: |
          npm audit --audit-level=high
          (cd dashboard && npm audit --audit-level=high)
```

- [ ] **Step 6: Verify**

Run: `npm audit --audit-level=high && (cd dashboard && npm audit --audit-level=high) && grep -E '"\^|"~' package.json dashboard/package.json; npm test 2>&1 | tail -8`
Expected: both audits exit 0; grep prints nothing; `fail 0`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json dashboard/package.json dashboard/package-lock.json .github/workflows/test.yml
git commit -m "chore(deps): npm audit fix, nodemailer 10, pin direct deps exactly, gate CI on high advisories"
```

---

### Task 13: Threat model and beginner manual (decision 13)

**Files:**
- Create: `docs/THREAT-MODEL.md`
- Create: `docs/UPEC-MANUAL.md`
- Test: `test/upec-docs.test.js`

**Interfaces:**
- Consumes: final names from Tasks 1-12: `relay.required`, `email.smtp.from`, `--generic`, `generic.enabled`, `network.required`, `network.proxy`, `browser.persistentProfile`, `AIDR_PASSPHRASE_FILE`, `~/.config/auto-identity-remove/passphrase`, `scripts/harden.sh`, `aidr setup|preview|run|dashboard|doctor`, `docker compose run --rm watcher`.

- [ ] **Step 1: Write the failing test**

`test/upec-docs.test.js`:

```js
/**
 * test/upec-docs.test.js
 *
 * The club docs must exist and mention every safety setting by its real name,
 * so a rename in code breaks this test instead of silently stranding members.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('manual covers each platform section', () => {
  const m = read('docs/UPEC-MANUAL.md');
  for (const h of ['## Part A: Windows (WSL2)', '## Part B: Linux', '## Part C: Docker', '## Part D: Every month', '## Troubleshooting']) {
    assert.ok(m.includes(h), h);
  }
});

test('manual names every safety setting exactly', () => {
  const m = read('docs/UPEC-MANUAL.md');
  for (const s of ['"required": true', 'smtp', '"from"', 'network', 'AIDR_PASSPHRASE_FILE', 'scripts/harden.sh', 'aidr preview', 'Lockdown mode', '/mnt/c']) {
    assert.ok(m.includes(s), s);
  }
});

test('threat model states the limits', () => {
  const t = read('docs/THREAT-MODEL.md');
  for (const s of ['does not protect', 'one instance per member', 'CapSolver', 'generic']) {
    assert.ok(t.toLowerCase().includes(s.toLowerCase()), s);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/upec-docs.test.js`
Expected: FAIL - ENOENT.

- [ ] **Step 3: Write `docs/THREAT-MODEL.md`**

Sections and required content (prose, short paragraphs, plain hyphens only):

1. `# Threat model` - one paragraph: the tool submits your identity to hundreds of companies on purpose; the goal is that each one learns nothing it did not already have, plus an alias.
2. `## What each layer protects` - a table with columns Layer / Stops / Does not stop:
   - SimpleLogin alias (fail-closed): brokers learning your real email; does not stop the broker from linking the alias to your name (it is on the same form).
   - VPN/proxy egress check: brokers and search engines seeing your home IP; does not cover CapSolver, HIBP, SimpleLogin or SMTP traffic unless the VPN is system-wide (Mullvad app); does not survive the VPN dropping mid-run unless Mullvad Lockdown mode is on.
   - Ephemeral browser profile: cookies and fingerprint state accumulating across broker sites; does not stop per-run fingerprinting.
   - Generic pass off: your data going to ~490 sites nobody reviewed; turning it on with `--generic` accepts that.
   - Encryption at rest: someone copying `config.json` off a stopped disk or a backup; does not protect against malware running as your user while the tool runs.
   - Unprivileged user / Docker, umask 077, `scripts/harden.sh`: other local accounts reading your PII; does not protect against root on that machine.
   - Loopback-only dashboard: anyone on the network reaching your config; does not protect against other programs on the same machine (it still has a login).
   - No notifications: run results (which brokers hold your data) reaching a phone, chat service or ntfy topic.
3. `## What this tool does not protect` - bullets: the confirmation step (`Submitted` is not `deleted`; run `aidr verify`); brokers re-adding you; your SMTP provider seeing every opt-out email; CapSolver seeing which broker pages you visit; anyone who already has your user account.
4. `## Rules for the club` - **one instance per member**, on a machine that member controls; never a shared server or a shared config; never paste `config.json`, `state.json`, logs or screenshots into club chat; report a suspected leak privately to the fork maintainer.

- [ ] **Step 4: Write `docs/UPEC-MANUAL.md`**

Audience: someone who has never opened a terminal. Every command in its own code block, with one sentence before it saying what it does and one after saying what you should see. Structure:

- `# UPEC guide to auto-identity-remove` + "What this does" (3 sentences) + "What you need before starting": a Mullvad account (mullvad.net, pay without an email), a SimpleLogin account (simplelogin.io) with an API key, about 1 hour.
- `## Before you start: Mullvad` - install the app, connect, turn on **Lockdown mode** (Settings -> VPN settings), check https://am.i.mullvad.net shows "You are using Mullvad".
- `## Before you start: SimpleLogin` - create the account, Settings -> API Keys -> Create, copy the key somewhere safe. Explain in one line why: brokers get a throwaway address instead of yours.
- `## Part A: Windows (WSL2)`:
  1. Open PowerShell as Administrator; `wsl --install -d Ubuntu`; reboot; pick a Linux username and password.
  2. Open "Ubuntu" from Start. Explain the prompt. **Stay in your Linux home folder; never use `/mnt/c`** - one sentence on why (file permissions do not work there).
  3. `sudo apt update && sudo apt install -y git curl`; install Node 20 via `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`; check `node -v` prints v20.
  4. Clone the fork into `~` (`git clone <fork URL> ~/auto-identity-remove`), `cd ~/auto-identity-remove`, `bash install.sh`, `npx playwright install-deps chromium`.
  5. Continue at "Configure" below.
- `## Part B: Linux` (Ubuntu/Debian): same as A step 3-4, preceded by creating a dedicated user: `sudo useradd -m -s /bin/bash aidr && sudo passwd aidr && sudo -iu aidr`. Mullvad CLI: `mullvad connect`, `mullvad lockdown-mode set on`, `mullvad status`.
- `## Configure` (shared by A and B):
  1. `node bin/aidr.js setup`; answer the questions.
  2. Open `config.json` with `nano config.json` (explain Ctrl+O, Enter, Ctrl+X) and set, showing the exact JSON:
     `"relay": { "provider": "simplelogin", "apiKey": "<your key>", "required": true }`,
     `"email": { "smtp": { ..., "from": "<an address that is not your real one>" } }` - or delete the `email` block to handle email brokers by hand,
     `"network": { "required": true, "proxy": "" }`.
  3. `bash scripts/harden.sh` - expect "Permissions hardened". If it says chmod has no effect, you are on `/mnt/c`: go back to Part A step 2.
  4. Optional encryption: create the file with `install -m 600 /dev/null ~/.config/auto-identity-remove/passphrase`, `nano` it, type a long passphrase, then `AIDR_PASSPHRASE_FILE=~/.config/auto-identity-remove/passphrase node watcher.js --encrypt-config`. Warn: lose the passphrase and you must redo setup.
  5. `node bin/aidr.js doctor`.
  6. `node bin/aidr.js preview` - nothing is submitted; expect `🛡  Network: Mullvad exit`. Then `node bin/aidr.js run`.
- `## Part C: Docker` - install Docker Desktop (Windows: enable the WSL2 backend) or `docker.io` on Linux; keep Mullvad connected on the host; clone into `~`; `cp config.example.json config.json` and edit as in Configure step 2; `touch state.json && mkdir -p logs && mkdir -m 700 secrets && install -m 600 /dev/null secrets/aidr-passphrase` (or remove the `secrets` lines from `docker-compose.yml` if not encrypting); `docker compose build`; `docker compose run --rm watcher node watcher.js --dry-run`; then `docker compose run --rm watcher`.
- `## Part D: Every month` - connect Mullvad, `node bin/aidr.js run` (or the Docker command), then check your SimpleLogin inbox for "confirm your request" emails and click them, then `node bin/aidr.js pending`. The scheduled job from setup does the run part automatically on the 1st; you still do the inbox part.
- `## Dashboard (optional)` - `node bin/aidr.js dashboard`, open the printed URL, use the printed login. It only works on this computer.
- `## Troubleshooting` - a table: message -> what to do. Rows: `Network check failed` -> connect Mullvad, check am.i.mullvad.net; `Skipping <name>: Relay alias creation failed` -> check the SimpleLogin API key and that the account is verified; `config.relay.required is true but no usable relay` -> add the apiKey; `Refusing to run as root` -> do not use sudo for the tool; `chmod has no effect` -> move off `/mnt/c`; `Passphrase file ... readable by other users` -> `chmod 600 <file>`; `not sent: email.smtp.from ...` -> set `from` or handle that broker by hand; `aidr-dashboard: AIDR_HOST=... is not a loopback address` -> unset `AIDR_HOST`.
- Closing line: read `docs/THREAT-MODEL.md`.

- [ ] **Step 5: Run tests**

Run: `node --test test/upec-docs.test.js test/docs-commands.test.js`
Expected: PASS. If `docs-commands.test.js` validates commands found in `docs/*.md`, fix the manual to match real commands rather than editing that test.

- [ ] **Step 6: Commit**

```bash
git add docs/THREAT-MODEL.md docs/UPEC-MANUAL.md test/upec-docs.test.js
git commit -m "docs(fork): threat model and beginner manual for UPEC members"
```

---

### Task 14: Whole-branch verification

- [ ] **Step 1:** `npm test 2>&1 | tail -10` and `(cd dashboard && node --test 2>&1 | tail -6)` - expect `fail 0` in both. Paste the counts into the final report.
- [ ] **Step 2:** Leak greps - each must print nothing:

```bash
grep -n "using real email" -r lib watcher.js
grep -n "User=root\|/root/.cache" -r dashboard lib docs/*.md README.md FORK.md
grep -n "0\.0\.0\.0" dashboard/README.md SECURITY.md
grep -rn "AIDR_PASS=change-me" .  --include=*.service --include=*.md
grep -n "launchPersistentContext" watcher.js
grep -rn "sendText\|desktopNotify\|dispatchNotify\|emailReportTo" lib watcher.js setup.js dashboard/server.js dashboard/public
grep -rnP "[\x{2013}\x{2014}]" --include=*.js --include=*.md --include=*.sh --include=*.yml . | grep -v node_modules
```

- [ ] **Step 3:** Run the superpowers:requesting-code-review skill over `git diff 99fb638..HEAD`, with the spec and this plan as context. Address findings before declaring done.
- [ ] **Step 4:** Report to the owner: commits, test counts, the manual Docker and Mullvad on/off verification still outstanding, and that the repo must be moved off `/mnt/c` before real use.
