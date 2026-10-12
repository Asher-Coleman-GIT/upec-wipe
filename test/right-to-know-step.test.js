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
