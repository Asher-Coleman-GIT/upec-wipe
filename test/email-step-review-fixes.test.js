'use strict';
// Fixes from the final review of the phase 2 email branch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const step = require('../lib/email-step');
const { smtpTransportOptions } = require('../lib/email');

const P = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', city: 'Provo', state: 'UT', email: 'jane.doe@example.com' };
const TX = { firstName: 'John', lastName: 'Doe', fullName: 'John Doe', city: 'Austin', state: 'TX', email: 'john.doe@example.com' };
const FROM = 'requests.only@example.net';
const SMTP = { host: 'smtp.example.net', port: 587, user: FROM, pass: 'pw', from: FROM };
const T = (name, to, kind = 'utah') => ({ name, domain: `${name.toLowerCase()}.com`, to, basis: { kind, quote: 'Q.', url: `https://${name.toLowerCase()}.com/p` } });
const NOW = () => '2026-10-12T00:00:00.000Z';
const items = () => ['Alpha', 'Beta', 'Gamma'].map(n => ({ key: n, name: n, to: `p@${n.toLowerCase()}.com`, basis: null, subject: 'S', body: 'B' }));
function opts(sendMail, extra = {}) {
  const state = { optOuts: {} };
  return { state, o: { transport: { sendMail }, from: FROM, paceMs: 1, sleep: async () => {}, state, save: () => {}, log: () => {}, now: NOW, ...extra } };
}

test('#1 a connection error stops the run and counts no broker failure', async () => {
  for (const err of [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }), Object.assign(new Error('Greeting never received'), { code: 'ECONNECTION' }), new Error('socket hang up')]) {
    const { state, o } = opts(async () => { throw err; });
    const r = await step.sendEmailPlan(items(), o);
    assert.equal(r.stopped, 'connection');
    assert.deepEqual(state.emailFailures, {});
    assert.equal(r.failed.length, 0);
    assert.deepEqual(state.emailSent, {});
  }
  assert.equal(step.classifySmtpError({ code: 'EENVELOPE', responseCode: 553 }), 'broker');
});

test('#2 a utah-basis broker is emailed only for a Utah resident; all-us goes to everyone', () => {
  const plan = step.buildEmailPlan({ targets: [T('Alpha', 'p@alpha.com', 'utah'), T('Beta', 'p@beta.com', 'all-us')], brokers: [], persons: [P, TX], state: { optOuts: {} }, from: FROM, maxPerRun: 100 });
  assert.deepEqual(plan.items.map(i => i.key), ['Alpha|Jane Doe', 'Beta|Jane Doe', 'Beta|John Doe']);
});

test('#2 a person with no valid US state is skipped with a note', () => {
  const plan = step.buildEmailPlan({ targets: [T('Beta', 'p@beta.com', 'all-us')], brokers: [], persons: [{ ...P, state: '' }], state: { optOuts: {} }, from: FROM, maxPerRun: 100 });
  assert.deepEqual(plan.items, []);
  assert.match(plan.notes.join('\n'), /person #1.*no US state/);
});

test('#7 one address is emailed once per person', () => {
  const plan = step.buildEmailPlan({ targets: [T('Spokeo', 'privacy@spokeo.com', 'all-us')], brokers: [{ name: 'Spokeo (email)', method: 'email', emailTo: 'Privacy@Spokeo.com' }], persons: [P], state: { optOuts: {} }, from: FROM, maxPerRun: 100 });
  assert.deepEqual(plan.items.map(i => i.name), ['Spokeo']);
});

test('#8 the network is checked before every send; a failed check stops cleanly', async () => {
  let checks = 0; const sent = [];
  const { state, o } = opts(async m => { sent.push(m.to); return { messageId: 'x' }; }, {
    beforeSend: async () => { checks++; if (checks === 2) throw Object.assign(new Error('Network check failed'), { name: 'EgressError' }); },
  });
  const r = await step.sendEmailPlan(items(), o);
  assert.equal(checks, 2);
  assert.deepEqual(sent, ['p@alpha.com']);
  assert.equal(r.stopped, 'egress');
  assert.deepEqual(Object.keys(state.emailSent), ['Alpha']);
});

test('#8 the setup check refuses a proxy-only or no-VPN network config', () => {
  assert.match(step.checkEmailSetup({ config: { email: { smtp: SMTP }, network: { proxy: 'socks5://10.64.0.1:1080' } }, persons: [P], isTTY: true }), /network\.proxy/);
  assert.match(step.checkEmailSetup({ config: { email: { smtp: SMTP }, network: { required: false } }, persons: [P], isTTY: true }), /network\.required/);
});

test('#3 emailStatus reads single- and multi-person keys', () => {
  const state = { emailSent: { 'Alpha|Jane Doe': { to: 'a', at: '2026-10-12T01:00:00Z' }, 'Alpha|John Doe': { to: 'a', at: '2026-10-13T01:00:00Z' }, Beta: { to: 'b', at: '2026-10-11T00:00:00Z', status: 'unknown' } },
    emailReplies: { 'Alpha|Jane Doe': { outcome: 'honored', at: '2026-10-14T00:00:00Z' } } };
  assert.deepEqual(step.emailStatus(state, 'Alpha'), { status: 'sent 2026-10-13 (2)', reply: 'honored 2026-10-14' });
  assert.deepEqual(step.emailStatus(state, 'Beta'), { status: 'unknown', reply: null });
  assert.deepEqual(step.emailStatus(state, 'Gamma'), { status: 'not sent', reply: null });
});

test('#4 the SMTP greeting never carries the machine hostname', () => {
  assert.equal(smtpTransportOptions(SMTP).name, 'localhost');
});
