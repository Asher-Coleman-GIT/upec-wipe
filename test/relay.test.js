/**
 * test/relay.test.js
 *
 * Pure unit tests for lib/relay.js.
 * No live network. No real config.json / state.json.
 *
 * Tested behaviours:
 *  1. getSubmissionEmail - no relay -> RelayUnavailableError unless relay.required is false
 *  2. getSubmissionEmail - relay.required false -> returns person.email
 *  3. getSubmissionEmail - relay configured -> calls createImpl, caches alias
 *  4. getSubmissionEmail - second call reuses cached alias (createImpl not called again)
 *  5. getSubmissionEmail - distinct persons get distinct cache slots
 *  6. personKey - stable, lowercased email-based key
 *  7. createSimpleLoginAlias - posts to the documented endpoint with Authentication header
 *  8. createSimpleLoginAlias - throws a useful error on non-ok response
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

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

// -- Fixtures ------------------------------------------------------------------

const PERSON_A = {
  firstName: 'Jane',
  lastName: 'Doe',
  fullName: 'Jane Doe',
  email: 'jane.doe@example.com',
};

const PERSON_B = {
  firstName: 'John',
  lastName: 'Smith',
  fullName: 'John Smith',
  email: 'john.smith@example.com',
};

function makeState() {
  return { optOuts: {} };
}

const RELAY_CFG = { relay: { provider: 'simplelogin', apiKey: 'sl-test-key' } };

// -- Tests --------------------------------------------------------------------

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

test('relay.required false and no apiKey falls back to person.email', async () => {
  const state = makeState();
  let createCalls = 0;
  const createImpl = async () => { createCalls += 1; return 'x@aliases.test'; };

  const out = await getSubmissionEmail({
    config: { relay: { provider: 'simplelogin', required: false } },
    person: PERSON_A,
    state,
    createImpl,
  });

  assert.equal(out, 'jane.doe@example.com');
  assert.equal(createCalls, 0, 'createImpl must not be called without an apiKey');
});

test('relay with no apiKey and no required key blocks the person', async () => {
  await assert.rejects(
    () => getSubmissionEmail({ config: { relay: { provider: 'simplelogin' } }, person: PERSON_A, state: makeState() }),
    RelayUnavailableError
  );
});

test('relay configured creates an alias via createImpl and caches it', async () => {
  const state = makeState();
  const createArgs = [];
  const createImpl = async (args) => { createArgs.push(args); return 'jane.alias@aliases.simplelogin.io'; };

  const out = await getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state, createImpl });

  assert.equal(out, 'jane.alias@aliases.simplelogin.io');
  assert.equal(createArgs.length, 1, 'createImpl should be called exactly once');
  assert.equal(createArgs[0].apiKey, 'sl-test-key');
  // M2: the alias note is stored at SimpleLogin, so it must not name the person.
  assert.equal(createArgs[0].note, 'upec-wipe');
  for (const pii of ['Jane', 'Doe', 'jane.doe@example.com']) assert.ok(!createArgs[0].note.includes(pii), `note leaks ${pii}`);
  const key = personKey(PERSON_A);
  assert.equal(state.relayAliases[key], 'jane.alias@aliases.simplelogin.io');
});

test('relay.required false with a fully configured relay still returns the alias, never the real email', async () => {
  const state = makeState();
  let createCalls = 0;
  const createImpl = async () => { createCalls += 1; return 'jane.optional@aliases.simplelogin.io'; };
  const out = await getSubmissionEmail({ config: { relay: { ...RELAY_CFG.relay, required: false } }, person: PERSON_A, state, createImpl });
  assert.equal(out, 'jane.optional@aliases.simplelogin.io');
  assert.notEqual(out, PERSON_A.email);
  assert.equal(createCalls, 1);
});

test('second call reuses the cached alias without calling createImpl again', async () => {
  const state = makeState();
  let createCalls = 0;
  const createImpl = async () => { createCalls += 1; return 'cached@aliases.simplelogin.io'; };

  const first = await getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state, createImpl });
  const second = await getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state, createImpl });

  assert.equal(first, 'cached@aliases.simplelogin.io');
  assert.equal(second, 'cached@aliases.simplelogin.io');
  assert.equal(createCalls, 1, 'createImpl should run only on the first call');
});

test('distinct persons get distinct cached aliases', async () => {
  const state = makeState();
  let n = 0;
  const createImpl = async () => (++n === 1 ? 'jane@a.io' : 'john@a.io');

  const a = await getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state, createImpl });
  const b = await getSubmissionEmail({ config: RELAY_CFG, person: PERSON_B, state, createImpl });

  assert.equal(a, 'jane@a.io');
  assert.equal(b, 'john@a.io');
  assert.notEqual(personKey(PERSON_A), personKey(PERSON_B));
});

test('personKey is stable and case-insensitive on email', () => {
  const upper = personKey({ email: 'Jane.Doe@Example.com', firstName: 'Jane', lastName: 'Doe' });
  const lower = personKey({ email: 'jane.doe@example.com', firstName: 'Jane', lastName: 'Doe' });
  assert.equal(upper, lower);
});

test('RELAY_PROVIDERS lists simplelogin', () => {
  assert.equal(RELAY_PROVIDERS.includes('simplelogin'), true);
});

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

test('createSimpleLoginAlias throws a useful error on a non-ok response', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Wrong api key' }),
  });

  await assert.rejects(
    () => createSimpleLoginAlias({ apiKey: 'bad', note: 'x', fetchImpl }),
    /SimpleLogin alias creation failed.*401/
  );
});

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
  assert.equal(relayRequired({ relay: { required: 'yes' } }), true);
  assert.equal(relayRequired({}), true);
  assert.equal(relayRequired(undefined), true);
  assert.equal(relayRequired({ relay: { required: false } }), false);
});

test('smtpFromLeakReason flags missing, equal, display-name and mixed-case from addresses', () => {
  const p = { email: 'jane.doe@example.com' };
  assert.match(smtpFromLeakReason({ user: 'jane.doe@example.com' }, p), /smtp\.from/);
  assert.match(smtpFromLeakReason({ from: 'jane.doe@example.com' }, p), /real email/);
  assert.match(smtpFromLeakReason({ from: 'Jane <Jane.Doe@Example.com>' }, p), /real email/);
  assert.equal(smtpFromLeakReason({ from: 'optouts@my-alias-domain.org' }, p), null);
  assert.match(smtpFromLeakReason(undefined, p), /smtp\.from/);
});

test('smtpFromLeakReason flags an SMTP login (smtp.user) that is the real email, any case', () => {
  const p = { email: 'jane.doe@example.com' };
  const r1 = smtpFromLeakReason({ from: 'optouts@my-alias-domain.org', user: 'jane.doe@example.com' }, p);
  assert.match(r1, /smtp\.user/);
  assert.ok(!r1.includes('jane.doe@example.com'), 'reason must not contain the address');
  assert.match(smtpFromLeakReason({ from: 'optouts@my-alias-domain.org', user: 'Jane.Doe@Example.COM' }, p), /smtp\.user/);
  assert.match(smtpFromLeakReason({ from: 'optouts@my-alias-domain.org', user: ' JANE.DOE@example.com ' }, p), /smtp\.user/);
  assert.equal(smtpFromLeakReason({ from: 'optouts@my-alias-domain.org', user: 'separate-box@example.net' }, p), null);
});

// I6 (final review): preview/dry-run never mints a SimpleLogin alias.
test('preview: no cached alias -> placeholder, createImpl never called, nothing cached', async () => {
  const { PREVIEW_ALIAS } = require('../lib/relay');
  assert.equal(PREVIEW_ALIAS, 'preview-alias@relay.invalid');
  const state = makeState();
  let calls = 0;
  const out = await getSubmissionEmail({
    config: { relay: { ...RELAY_CFG.relay, required: true } }, person: PERSON_A, state,
    createImpl: async () => { calls += 1; return 'minted@simplelogin.com'; }, preview: true,
  });
  assert.equal(out, 'preview-alias@relay.invalid');
  assert.equal(calls, 0);
  assert.equal((state.relayAliases || {})[personKey(PERSON_A)], undefined, 'placeholder must not be cached');
});

test('preview: cached alias is used', async () => {
  const state = makeState();
  state.relayAliases = { [personKey(PERSON_A)]: 'cached@simplelogin.com' };
  const out = await getSubmissionEmail({
    config: RELAY_CFG, person: PERSON_A, state, preview: true,
    createImpl: async () => { throw new Error('must not be called'); },
  });
  assert.equal(out, 'cached@simplelogin.com');
});

test('preview: relay.required with no usable relay still blocks', async () => {
  await assert.rejects(
    () => getSubmissionEmail({ config: { relay: { provider: 'simplelogin', required: true } }, person: PERSON_A, state: makeState(), preview: true }),
    RelayUnavailableError
  );
});

// Review 2026-10-15 (low): the alias cache in state.json was keyed by the real
// email, unencrypted even after --encrypt-config.
test('the alias cache key holds no email or name', async () => {
  const state = makeState();
  await getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state, createImpl: async () => 'a1@sl.example' });
  const keys = Object.keys(state.relayAliases);
  assert.equal(keys.length, 1);
  for (const pii of ['jane', 'doe', '@']) assert.ok(!keys[0].toLowerCase().includes(pii), `key leaks ${pii}: ${keys[0]}`);
});

test('an alias cached under the old email key is reused and moved to the new key', async () => {
  const state = { relayAliases: { 'jane.doe@example.com': 'old@sl.example' } };
  let created = 0;
  const out = await getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state, createImpl: async () => { created++; return 'new@sl.example'; } });
  assert.equal(out, 'old@sl.example');
  assert.equal(created, 0, 'no new alias is made');
  assert.deepEqual(Object.values(state.relayAliases), ['old@sl.example']);
  assert.equal(state.relayAliases['jane.doe@example.com'], undefined);
});
