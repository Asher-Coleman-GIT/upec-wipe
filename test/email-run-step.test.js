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
  assert.equal(out.egress, 2); // once before the transport opens, once before the send
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

test('resends count toward maxPerRun and go first', async () => {
  const state = { optOuts: {}, emailSent: { Alpha: { to: 'p@alpha.com', at: 't', status: 'unknown' } } };
  const two = [...targets, { name: 'Beta', domain: 'beta.com', to: 'p@beta.com', basis: null }];
  const cfg = { email: { ...config.email, maxPerRun: 1 } };
  const { d, out } = deps({ config: cfg, state, targets: two, ask: async q => (/Resend/.test(q) ? 'y' : 'SEND') });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 1);
  assert.equal(out.sent[0].to, 'p@alpha.com');
});

test('a stopped email run names the real command to re-run', async () => {
  const err = Object.assign(new Error('connect failed'), { code: 'ECONNECTION' });
  const { d, out } = deps({ makeTransport: () => ({ sendMail: async () => { throw err; } }) });
  assert.equal(await runEmailStep(d), 1);
  assert.match(out.lines.join('\n'), /run upec-wipe run --email again/);
});

test('a resend cut by the cap stays unknown for the next run', async () => {
  const state = { optOuts: {}, emailSent: {
    Alpha: { to: 'p@alpha.com', at: 't', status: 'unknown' },
    Beta: { to: 'p@beta.com', at: 't', status: 'unknown' },
  } };
  const two = [...targets, { name: 'Beta', domain: 'beta.com', to: 'p@beta.com', basis: null }];
  const cfg = { email: { ...config.email, maxPerRun: 1 } };
  const { d, out } = deps({ config: cfg, state, targets: two, ask: async q => (/Resend/.test(q) ? 'y' : 'SEND') });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 1);
  assert.equal(state.emailSent.Alpha.messageId, 'x');
  assert.equal(state.emailSent.Beta.status, 'unknown');
  assert.equal(state.emailSent.Beta.assumed, undefined);
});

test('a logged bounce moves a sent email to manual', async () => {
  const state = { optOuts: {}, emailSent: { Alpha: { to: 'p@alpha.com', at: 't', messageId: 'm' } }, emailReplies: { Alpha: { outcome: 'bounced', at: 't' } } };
  const { d, out } = deps({ state });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 0);
  assert.match(out.lines.join('\n'), /manual Alpha: email to p@alpha\.com failed or bounced/);
});

test('a bounced interrupted send goes to manual without a resend prompt', async () => {
  const state = { optOuts: {}, emailSent: { Alpha: { to: 'p@alpha.com', at: 't', status: 'unknown' } }, emailReplies: { Alpha: { outcome: 'bounced', at: 't' } } };
  const { d, out } = deps({ state, ask: async (q) => { if (/Resend/.test(q)) throw new Error('must not ask'); return 'SEND'; } });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 0);
  assert.match(out.lines.join('\n'), /manual Alpha/);
});

test('an address that failed twice goes to manual', async () => {
  const state = { optOuts: {}, emailFailures: { Alpha: 2 } };
  const { d, out } = deps({ state });
  assert.equal(await runEmailStep(d), 0);
  assert.equal(out.sent.length, 0);
  assert.match(out.lines.join('\n'), /manual Alpha/);
});
