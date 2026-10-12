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
