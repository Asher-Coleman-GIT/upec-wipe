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

test('a request recorded by the old sender (knowRequestedAt, no know: key) is not sent again', async () => {
  const state = { optOuts: { Pipl: { knowRequestedAt: '2026-01-01T00:00:00.000Z' } } };
  const { d, out } = deps({ state });
  assert.deepEqual(buildKnowPlan({ ...d, maxPerRun: 100 }), []);
  assert.equal(await runKnowStep(d), 0);
  assert.equal(out.sent.length, 0);
});

test('an interrupted send (status unknown) is noted once and not sent again', async () => {
  const state = { optOuts: {}, emailSent: { [`${KNOW_PREFIX}Pipl|Jane Doe`]: { to: 'privacy@pipl.com', status: 'unknown' }, [`${KNOW_PREFIX}Other`]: { messageId: 'm' } } };
  const { d, out } = deps({ state, brokers: [] });
  assert.equal(await runKnowStep(d), 0);
  const notes = out.lines.filter(l => l.includes('may or may not have been sent'));
  assert.deepEqual(notes, ["  note: Pipl right-to-know request may or may not have been sent last time; it is not sent again. Check the dedicated mailbox's Sent folder."]);
  assert.equal(out.sent.length, 0);
});

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

test('a failing egress gate sends nothing', async () => {
  const { EgressError } = require('../lib/egress');
  const { d, out } = deps({ ensureEgress: async () => { throw new EgressError('off'); } });
  await assert.rejects(() => runKnowStep(d), EgressError);
  assert.equal(out.sent.length, 0);
  assert.equal(out.transports, 0);
});
