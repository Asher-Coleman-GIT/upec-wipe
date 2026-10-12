/**
 * lib/relay.js
 *
 * Masked-email relay integration.
 *
 * When config.relay = { provider: 'simplelogin', apiKey } is set, opt-out
 * submissions use a per-person masked alias instead of the person's real
 * email address, so brokers never receive a fresh real address. The alias is
 * created once per person and cached in state.relayAliases[personKey] so a new
 * alias is not minted on every run.
 *
 * getSubmissionEmail is a pure provider-decision function: the only side effect
 * (creating an alias) is injected via createImpl, which defaults to the real
 * SimpleLogin API call. With no usable relay it throws RelayUnavailableError
 * unless relay.required is false.
 *
 * Manual fallbacks (Apple Hide My Email, Firefox Relay) are documented in
 * docs/relay.md; they cannot be automated via API here, so users paste the
 * generated alias into config.person.email manually for those providers.
 */

'use strict';

const { ensureNodeEgress } = require('./egress');

// Documented in github.com/simple-login/app docs/api.md. The address is returned
// in the `email` field. The upstream code used the undocumented
// /api/alias/custom/new with only {note} and read `alias`, so it never produced
// an alias and every run fell back to the real email.
const SIMPLELOGIN_ALIAS_URL = 'https://app.simplelogin.io/api/alias/random/new?mode=word';

// Stand-in address for preview/dry-run when no alias is cached yet: previews
// must not mint real aliases. The .invalid TLD can never be delivered.
const PREVIEW_ALIAS = 'preview-alias@relay.invalid';

// Providers supported via API automation. Apple Hide My Email and Firefox Relay
// are documented manual fallbacks (no public alias-creation API), so they are
// intentionally not listed here.
const RELAY_PROVIDERS = ['simplelogin'];

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

// True when relay.apiKey is the example/setup placeholder (YOUR_...).
function relayKeyIsPlaceholder(config) {
  const relay = config && config.relay;
  const key = relay && typeof relay.apiKey === 'string' ? relay.apiKey.trim() : '';
  return key.startsWith('YOUR_');
}

// Fail closed by default (fork rule): only an explicit required: false lets a
// person without an alias submit under their real email.
function relayRequired(config) {
  return !(config && config.relay && config.relay.required === false);
}

/**
 * When an alias is advertised, neither the From header nor the SMTP login
 * (smtp.user) may carry the real address, or the broker learns it anyway.
 * Returns null when safe, else a reason (never containing the address itself).
 */
function smtpFromLeakReason(smtpCfg, person) {
  const from = smtpCfg && typeof smtpCfg.from === 'string' ? smtpCfg.from.trim() : '';
  if (!from) return 'email.smtp.from is not set, so mail would go out from the SMTP login';
  const real = person && person.email ? String(person.email).trim().toLowerCase() : '';
  if (real && from.toLowerCase().includes(real)) return 'email.smtp.from is your real email';
  // The SMTP login is visible to the broker too: providers such as Gmail
  // rewrite From to the account address, and it lands in Return-Path and the
  // envelope sender regardless of From.
  const user = smtpCfg && typeof smtpCfg.user === 'string' ? smtpCfg.user.trim().toLowerCase() : '';
  if (real && user && user.includes(real)) return 'email.smtp.user (the SMTP login) is your real email, and brokers can see it';
  return null;
}

/**
 * Operator advice matching a smtpFromLeakReason() result. The fix for a leaking
 * smtp.user is different from the fix for a leaking smtp.from.
 * @param {string} reason
 * @returns {string}
 */
function smtpLeakAdvice(reason) {
  if (typeof reason === 'string' && reason.includes('smtp.user')) {
    return 'Use a separate SMTP mailbox that is not linked to you, or remove the email block and handle email brokers by hand.';
  }
  return 'Set email.smtp.from to a non-real address.';
}

/**
 * Stable, case-insensitive cache key for a person. Prefers the email address
 * (already unique per person); falls back to first+last name when absent.
 *
 * @param {{ email?: string, firstName?: string, lastName?: string }} person
 * @returns {string}
 */
function personKey(person) {
  const email = (person && person.email) ? String(person.email).trim().toLowerCase() : '';
  if (email) return email;
  const first = (person && person.firstName) ? String(person.firstName).trim().toLowerCase() : '';
  const last = (person && person.lastName) ? String(person.lastName).trim().toLowerCase() : '';
  return `${first} ${last}`.trim();
}

/**
 * Create a custom alias via the SimpleLogin API.
 *
 * POST https://app.simplelogin.io/api/alias/custom/new
 * Header: Authentication: <apiKey>
 *
 * @param {object} args
 * @param {string} args.apiKey   - SimpleLogin API key
 * @param {string} args.note     - human-readable note stored on the alias
 * @param {function} [args.fetchImpl] - injected for testing; defaults to global fetch
 * @returns {Promise<string>} the created alias email address
 */
async function createSimpleLoginAlias({ apiKey, note, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(SIMPLELOGIN_ALIAS_URL, {
    method: 'POST',
    headers: {
      'Authentication': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ note }),
  });

  if (!res || !res.ok) {
    const status = res ? res.status : 'no-response';
    let detail = '';
    try {
      const j = await res.json();
      detail = j && j.error ? `: ${j.error}` : '';
    } catch (_) {}
    throw new Error(`SimpleLogin alias creation failed (HTTP ${status})${detail}`);
  }

  const data = await res.json();
  if (!data || !data.email) {
    throw new Error('SimpleLogin alias creation failed: response missing "email" field');
  }
  return data.email;
}

/**
 * Default createImpl: routes to the configured provider's real alias creator.
 * Injected (and overridden) by tests.
 *
 * @param {object} args
 * @param {string} args.provider
 * @param {string} args.apiKey
 * @param {string} args.note
 * @returns {Promise<string>}
 */
async function defaultCreateImpl({ provider, apiKey, note }) {
  if (provider === 'simplelogin') {
    return createSimpleLoginAlias({ apiKey, note });
  }
  throw new Error(`Unsupported relay provider: ${provider}`);
}

/**
 * Resolve the email address to use when submitting an opt-out for `person`.
 *
 * - No usable relay -> RelayUnavailableError, unless relay.required is false (then person.email).
 * - Relay configured -> a cached alias from state.relayAliases[personKey], or a
 *   freshly created one (via createImpl) cached for subsequent runs.
 *
 * Pure aside from the cache write and the injected createImpl call. On any
 * creation error it throws RelayUnavailableError: a relay outage blocks that
 * person's submissions rather than leaking the real address.
 *
 * @param {object} args
 * @param {object} args.config       - full config object (reads config.relay)
 * @param {object} args.person       - person whose submission email we resolve
 * @param {object} [args.state]      - shared mutable state; alias cache stored under state.relayAliases
 * @param {function} [args.createImpl] - injected alias creator; defaults to defaultCreateImpl
 * @param {boolean} [args.preview] - preview/dry-run: never create an alias. Use
 *   the cached one, else PREVIEW_ALIAS (not cached). relay.required still applies.
 * @returns {Promise<string>}
 */
async function getSubmissionEmail({ config, person, state, createImpl, preview }) {
  const rawEmail = (person && person.email) || '';

  if (!relayConfigured(config)) {
    if (relayRequired(config)) {
      if (relayKeyIsPlaceholder(config)) {
        throw new RelayUnavailableError('relay.apiKey is still the placeholder. Paste your SimpleLogin API key into config.json, or set relay.required to false to send your real email instead');
      }
      throw new RelayUnavailableError('no usable relay is configured (provider "simplelogin" + apiKey). Add your SimpleLogin key to config.json, or set relay.required to false to send your real email instead');
    }
    return rawEmail;
  }

  const relay = config.relay;
  const key = personKey(person);
  const store = state || {};
  if (!store.relayAliases) store.relayAliases = {};

  const cached = store.relayAliases[key];
  if (cached) return cached;
  if (preview) return PREVIEW_ALIAS;

  // Node-direct call to SimpleLogin: fail closed off the VPN (audit M7). An
  // EgressError propagates; it is not a per-person relay outage.
  await ensureNodeEgress(config);

  const make = createImpl || defaultCreateImpl;
  let alias;
  try {
    alias = await make({
      provider: relay.provider,
      apiKey: relay.apiKey,
      // Neutral note: it is stored at SimpleLogin, so it must not name the person.
      note: 'upec-wipe',
    });
  } catch (err) {
    throw new RelayUnavailableError(`Relay alias creation failed: ${err.message}`);
  }
  if (!alias) throw new RelayUnavailableError('Relay alias creation returned no alias');
  store.relayAliases[key] = alias;
  return alias;
}

module.exports = {
  getSubmissionEmail,
  personKey,
  createSimpleLoginAlias,
  defaultCreateImpl,
  relayConfigured,
  relayRequired,
  relayKeyIsPlaceholder,
  smtpFromLeakReason,
  smtpLeakAdvice,
  RelayUnavailableError,
  RELAY_PROVIDERS,
  SIMPLELOGIN_ALIAS_URL,
  PREVIEW_ALIAS,
};
