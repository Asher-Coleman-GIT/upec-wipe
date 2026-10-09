/**
 * test/node-egress.test.js
 *
 * Audit M7 (follow-up C1 item 8). The browser had a fail-closed egress check,
 * but the Node-direct calls (SimpleLogin, CapSolver, HIBP, SMTP, the broker
 * registries, the doctor probes) connected from the machine with no check. In
 * proxy-only or split-tunnel setups they left from the home IP.
 *
 * ensureNodeEgress(config, { fetchJson }) runs once per process:
 * - network.required false: ok, nothing checked;
 * - network.proxy set: prints a one-time note that Node calls go direct, ok;
 * - otherwise am.i.mullvad.net/json must report mullvad_exit_ip true, else it
 *   throws EgressError and nothing is sent.
 *
 * Every test injects fetchJson or stubs global fetch; nothing here touches
 * the real network. The gate has no env-var bypass: the npm test scripts
 * preload test/helpers/egress-off.js instead.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const egress = require('../lib/egress');
const { EgressError } = egress;

const FAIL_MSG = 'Network check failed for direct connections - nothing was sent. Connect Mullvad (system-wide app) or set network.required to false.';
const PROXY_NOTE = 'Note: network.proxy covers the browser only. SimpleLogin, CapSolver, HIBP, SMTP and the broker registries connect directly from this machine.';

const ON_VPN = async () => ({ mullvad_exit_ip: true, country: 'X' });
const OFF_VPN = async () => ({ mullvad_exit_ip: false });

function failingGate(config) {
  egress._resetNodeEgress();
  const calls = [];
  egress.setEgressConfig(config || {}, { fetchJson: async (u) => { calls.push(u); return { mullvad_exit_ip: false }; } });
  return calls;
}

test.afterEach(() => egress._resetNodeEgress());

function captureLog(fn) {
  const lines = [];
  const orig = { log: console.log, warn: console.warn };
  console.log = console.warn = (...a) => lines.push(a.join(' '));
  return Promise.resolve().then(fn).finally(() => Object.assign(console, orig)).then(() => lines);
}

// -- ensureNodeEgress itself ---------------------------------------------------

test('network.required false: ok without any check', async () => {
  egress._resetNodeEgress();
  let called = 0;
  const r = await egress.ensureNodeEgress({ network: { required: false } }, { fetchJson: async () => { called++; return {}; } });
  assert.equal(r.ok, true);
  assert.equal(called, 0);
});

test('network.proxy set: prints the note once and does not check', async () => {
  egress._resetNodeEgress();
  let called = 0;
  const cfg = { network: { required: true, proxy: 'socks5://127.0.0.1:1080' } };
  const fetchJson = async () => { called++; return {}; };
  const lines = await captureLog(async () => {
    assert.equal((await egress.ensureNodeEgress(cfg, { fetchJson })).ok, true);
    assert.equal((await egress.ensureNodeEgress(cfg, { fetchJson })).ok, true);
  });
  assert.equal(called, 0);
  assert.equal(lines.filter(l => l.includes(PROXY_NOTE)).length, 1);
});

test('Mullvad exit: ok, checked once per process (cached)', async () => {
  egress._resetNodeEgress();
  const urls = [];
  const fetchJson = async (u) => { urls.push(u); return ON_VPN(); };
  assert.equal((await egress.ensureNodeEgress({ network: { required: true } }, { fetchJson })).ok, true);
  assert.equal((await egress.ensureNodeEgress({ network: { required: true } }, { fetchJson })).ok, true);
  assert.deepEqual(urls, ['https://am.i.mullvad.net/json']);
});

test('not on Mullvad: throws EgressError with the exact message, cached', async () => {
  egress._resetNodeEgress();
  let called = 0;
  const fetchJson = async () => { called++; return OFF_VPN(); };
  await assert.rejects(() => egress.ensureNodeEgress({}, { fetchJson }), (e) => e instanceof EgressError && e.message === FAIL_MSG);
  await assert.rejects(() => egress.ensureNodeEgress({}, { fetchJson }), EgressError);
  assert.equal(called, 1);
});

test('check page unreachable: throws EgressError', async () => {
  egress._resetNodeEgress();
  await assert.rejects(() => egress.ensureNodeEgress({}, { fetchJson: async () => { throw new Error('ENOTFOUND'); } }), EgressError);
});

test('no env-var bypass: NODE_ENV=test and NODE_TEST_CONTEXT still run the check', async () => {
  egress._resetNodeEgress();
  const prev = { env: process.env.NODE_ENV, ctx: process.env.NODE_TEST_CONTEXT };
  process.env.NODE_ENV = 'test';
  process.env.NODE_TEST_CONTEXT = 'child';
  const origFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => { urls.push(String(u)); return new Response('{"mullvad_exit_ip":false}', { status: 200 }); };
  try {
    await assert.rejects(() => egress.ensureNodeEgress({ network: { required: true } }), EgressError);
    assert.deepEqual(urls, [egress.MULLVAD_CHECK_URL]);
  } finally {
    globalThis.fetch = origFetch;
    if (prev.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev.env;
    if (prev.ctx === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = prev.ctx;
  }
});

test('lib/egress.js reads no env var to decide whether to check', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'egress.js'), 'utf8');
  assert.doesNotMatch(src, /NODE_ENV|NODE_TEST_CONTEXT|isTestEnv/);
});

test('every test command loads the egress-off preload', () => {
  const fs = require('node:fs'), path = require('node:path');
  const root = path.join(__dirname, '..');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(rootPkg.scripts.test, /--require[ =]\.\/test\/helpers\/egress-off\.js/);
  const dashPkg = JSON.parse(fs.readFileSync(path.join(root, 'dashboard', 'package.json'), 'utf8'));
  assert.match(dashPkg.scripts.test, /--require[ =]\.\.\/test\/helpers\/egress-off\.js/);
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8');
  const runs = ci.split('\n').filter((l) => /run:\s*node\b.*--test\b/.test(l));
  assert.ok(runs.length >= 2, 'found the CI test steps');
  for (const l of runs) assert.match(l, /--require[ =]\S*egress-off\.js/, l);
});

test('browser-session re-exports the same EgressError class', () => {
  assert.equal(require('../lib/browser-session').EgressError, EgressError);
});

// -- call sites ----------------------------------------------------------------

test('SimpleLogin: failing gate means the alias is never created', async () => {
  const { getSubmissionEmail } = require('../lib/relay');
  const config = { relay: { provider: 'simplelogin', apiKey: 'sl-key', required: true } };
  failingGate(config);
  let created = 0;
  await assert.rejects(
    () => getSubmissionEmail({ config, person: { email: 'p@example.com' }, state: {}, createImpl: async () => { created++; return 'a@sl.example'; } }),
    EgressError,
  );
  assert.equal(created, 0);
});

test('SimpleLogin: preview and cached aliases do not run the gate', async () => {
  const { getSubmissionEmail, PREVIEW_ALIAS } = require('../lib/relay');
  const config = { relay: { provider: 'simplelogin', apiKey: 'sl-key', required: true } };
  const calls = failingGate(config);
  const p = { email: 'p@example.com' };
  assert.equal(await getSubmissionEmail({ config, person: p, state: {}, preview: true, createImpl: async () => 'x' }), PREVIEW_ALIAS);
  const state = { relayAliases: { 'p@example.com': 'cached@sl.example' } };
  assert.equal(await getSubmissionEmail({ config, person: p, state, createImpl: async () => 'x' }), 'cached@sl.example');
  assert.equal(calls.length, 0);
});

test('buildSubmissionPlan propagates EgressError instead of blocking quietly', async () => {
  const { buildSubmissionPlan } = require('../lib/submission-plan');
  const config = { relay: { provider: 'simplelogin', apiKey: 'sl-key', required: true } };
  failingGate(config);
  let created = 0;
  await assert.rejects(() => buildSubmissionPlan({ config, persons: [{ email: 'p@example.com' }], state: {}, createImpl: async () => { created++; return 'a'; } }), EgressError);
  assert.equal(created, 0);
});

test('HIBP: failing gate means HIBP is never called', async () => {
  const { runBreachCheck } = require('../lib/hibp');
  const config = {};
  failingGate(config);
  let fetched = 0;
  await assert.rejects(() => runBreachCheck({ emails: ['p@example.com'], apiKey: 'k', config, fetchImpl: async () => { fetched++; return { status: 404 }; } }), EgressError);
  assert.equal(fetched, 0);
});

function stubNodemailer() {
  const calls = { transports: 0, sent: 0 };
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'nodemailer') {
      return { createTransport: () => { calls.transports++; return { sendMail: async () => { calls.sent++; return {}; } }; } };
    }
    return origLoad.apply(this, arguments);
  };
  return { calls, restore: () => { Module._load = origLoad; } };
}

test('SMTP opt-out email: failing gate means sendMail is never called', async () => {
  const configMod = require('../lib/config');
  const origLast = configMod.lastOptOutDaysAgo;
  configMod.lastOptOutDaysAgo = () => 999;
  const { calls, restore } = stubNodemailer();
  try {
    const email = require('../lib/email');
    const config = { person: { firstName: 'A', lastName: 'B', email: 'p@example.com', country: 'US' }, email: { smtp: { host: 'h', port: 587, user: 'u', pass: 'p', from: 'u' } } };
    failingGate(config);
    await assert.rejects(() => email.sendOptOutEmails([{ name: 'B', method: 'email', emailTo: 'x@broker.example' }], config, 'linux', {}), EgressError);
    assert.equal(calls.transports, 0);
    assert.equal(calls.sent, 0);
  } finally {
    restore();
    configMod.lastOptOutDaysAgo = origLast;
  }
});

test('SMTP right-to-know: failing gate means sendMail is never called', async () => {
  const { calls, restore } = stubNodemailer();
  try {
    const rtk = require('../lib/right-to-know-runner');
    const config = { person: { firstName: 'A', lastName: 'B', email: 'p@example.com', country: 'US' }, email: { smtp: { host: 'h', port: 587, user: 'u', pass: 'p', from: 'u' } } };
    failingGate(config);
    await assert.rejects(() => rtk.sendKnowRequests([{ name: 'B', method: 'email', emailTo: 'x@broker.example' }], config, {}), EgressError);
    assert.equal(calls.sent, 0);
  } finally {
    restore();
  }
});

test('registries: failing gate means the registries are never fetched', async () => {
  const feeds = require('../lib/feeds');
  failingGate({});
  let built = 0;
  await assert.rejects(() => feeds.runUpdateBrokers({ brokers: [], config: {}, buildFn: async () => { built++; return { brokers: [], stats: {} }; }, writeFn: () => {} }), EgressError);
  assert.equal(built, 0);
  let fetched = 0;
  await assert.rejects(() => feeds.fetchCaRegistry({ url: 'https://ca.test/r.csv', fetchImpl: async () => { fetched++; return { ok: true, text: async () => '' }; } }), EgressError);
  assert.equal(fetched, 0);
});

test('CapSolver: failing gate means createTask is never posted', async () => {
  const origLoad = Module._load;
  let posts = 0;
  Module._load = function (request) {
    if (request === 'axios') return { create: () => ({ post: async () => { posts++; return { data: {} }; } }) };
    return origLoad.apply(this, arguments);
  };
  try {
    const captcha = require('../lib/captcha');
    failingGate({});
    const page = { url: () => 'https://broker.example/opt-out', evaluate: async () => 'site-key' };
    const lines = await captureLog(async () => {
      assert.equal(await captcha.solveRecaptcha(page, { apiKey: 'CAP-REAL-KEY-1234567890' }), false);
    });
    assert.equal(posts, 0);
    assert.ok(lines.some(l => /Network check failed/.test(l)));
  } finally {
    Module._load = origLoad;
  }
});

test('doctor: failing gate turns the SMTP and CapSolver probes into "skipped: not on Mullvad"', async () => {
  const doctor = require('../lib/doctor');
  const cfg = { email: { smtp: { host: 'smtp.example.com', port: 587 } }, capsolver: { apiKey: 'CAP-REAL-KEY-1234567890' } };
  failingGate(cfg);
  let probes = 0;
  const smtp = await doctor.checkSMTP(cfg, { tcpProbe: async () => { probes++; return true; } });
  const cap = await doctor.checkCapsolver(cfg, { headRequest: async () => { probes++; return 200; } });
  assert.equal(probes, 0);
  assert.deepEqual(smtp, { ok: true, hint: 'skipped: not on Mullvad' });
  assert.deepEqual(cap, { ok: true, hint: 'skipped: not on Mullvad' });
});

test('watcher wires the gate config once', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'watcher.js'), 'utf8');
  assert.match(src, /setEgressConfig\(/);
});
