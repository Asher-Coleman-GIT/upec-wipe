/**
 * test/relay.test.js
 *
 * Pure unit tests for lib/relay.js.
 * No live network. No real config.json / state.json.
 *
 * Tested behaviours:
 *  1. getSubmissionEmail - no relay configured -> returns person.email unchanged
 *  2. getSubmissionEmail - relay configured but no apiKey -> returns person.email
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

test('no relay configured returns person.email unchanged', async () => {
  const state = makeState();
  let createCalls = 0;
  const createImpl = async () => { createCalls += 1; return 'should-not-be-used@aliases.test'; };

  const out = await getSubmissionEmail({ config: {}, person: PERSON_A, state, createImpl });

  assert.equal(out, 'jane.doe@example.com');
  assert.equal(createCalls, 0, 'createImpl must not be called when relay is absent');
  assert.equal(state.relayAliases, undefined, 'state must not be mutated when relay is absent');
});

test('relay configured but missing apiKey falls back to person.email', async () => {
  const state = makeState();
  let createCalls = 0;
  const createImpl = async () => { createCalls += 1; return 'x@aliases.test'; };

  const out = await getSubmissionEmail({
    config: { relay: { provider: 'simplelogin' } },
    person: PERSON_A,
    state,
    createImpl,
  });

  assert.equal(out, 'jane.doe@example.com');
  assert.equal(createCalls, 0, 'createImpl must not be called without an apiKey');
});

test('relay configured creates an alias via createImpl and caches it', async () => {
  const state = makeState();
  const createArgs = [];
  const createImpl = async (args) => { createArgs.push(args); return 'jane.alias@aliases.simplelogin.io'; };

  const out = await getSubmissionEmail({ config: RELAY_CFG, person: PERSON_A, state, createImpl });

  assert.equal(out, 'jane.alias@aliases.simplelogin.io');
  assert.equal(createArgs.length, 1, 'createImpl should be called exactly once');
  assert.equal(createArgs[0].apiKey, 'sl-test-key');
  assert.equal(createArgs[0].note.includes('Jane Doe'), true, 'note should reference the person');
  const key = personKey(PERSON_A);
  assert.equal(state.relayAliases[key], 'jane.alias@aliases.simplelogin.io');
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
  const createImpl = async ({ note }) => (note.includes('Jane Doe') ? 'jane@a.io' : 'john@a.io');

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
