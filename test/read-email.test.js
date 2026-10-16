'use strict';
/**
 * test/read-email.test.js
 *
 * `upec-wipe read-email`: reads the dedicated request mailbox read-only,
 * matches each reply to the broker that was emailed, suggests an outcome and
 * logs it only after the member says yes. Dummy person and mailbox only.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchBroker, readEmail } = require('../lib/read-email');

const TARGETS = [
  { name: 'FourLeaf', to: 'privacy@fourleafdata.com', domain: 'fourleafdata.com' },
  { name: 'Spokeo (email)', to: 'privacy@spokeo.com', domain: 'spokeo.com' },
  { name: 'Ownco', to: 'privacy@monitorbase.com', domain: 'monitorbase.com' },
  { name: 'Exact Match Marketing', to: 'datarequest@exactmatch.io', domain: 'exactmatchmarketing.com' },
  { name: 'Pipl', to: 'privacy@pipl.com', domain: 'pipl.com' },
  { name: 'Command Precision', to: 'privacy@persistent.id', domain: 'persistent.id' },
];
const msg = (o) => ({ from: o.from || o.fromAddress, fromAddress: o.fromAddress, subject: o.subject || 'Re: Privacy request', text: o.text || '', links: o.links || [], date: new Date('2026-10-15T10:00:00Z') });

test('replies match the emailed broker by sender domain, help-desk subdomain, display name or subject tag', () => {
  assert.equal(matchBroker(msg({ fromAddress: 'privacy@pipl.com' }), TARGETS).name, 'Pipl');
  assert.equal(matchBroker(msg({ fromAddress: 'datarequest+noreply@exactmatchmarketing.com' }), TARGETS).name, 'Exact Match Marketing');
  assert.equal(matchBroker(msg({ fromAddress: 'datarequest@exactmatch.io' }), TARGETS).name, 'Exact Match Marketing');
  assert.equal(matchBroker(msg({ fromAddress: 'support@spokeo.zendesk.com' }), TARGETS).name, 'Spokeo (email)');
  assert.equal(matchBroker(msg({ from: 'Privacy Team at Four Leaf Data <noreply@trustsuperset.com>', fromAddress: 'noreply@trustsuperset.com' }), TARGETS).name, 'FourLeaf');
  assert.equal(matchBroker(msg({ from: '"Privacy Team at persistent.id" <noreply@trustsuperset.com>', fromAddress: 'noreply@trustsuperset.com' }), TARGETS).name, 'Command Precision');
  assert.equal(matchBroker(msg({ fromAddress: 'support.monitorbase@mmi.io', subject: '[MonitorBase] Re: Ticket #1' }), TARGETS).name, 'Ownco');
  assert.equal(matchBroker(msg({ fromAddress: 'no-reply@accounts.google.com', subject: 'Security alert' }), TARGETS), null);
});

// Injected world: config, state, mailbox, prompts, egress.
function world({ messages = [], answers = [], egress = async () => {}, isTTY = true, config, state } = {}) {
  const logged = [];
  const out = [];
  const opened = [];
  const st = state || { emailSent: { FourLeaf: { at: '2026-10-15T09:00:00Z' }, Pipl: { at: '2026-10-15T09:05:00Z' }, 'Spokeo (email)': { at: '2026-10-15T09:10:00Z' } }, emailReplies: {} };
  const deps = {
    config: config || { email: { smtp: { host: 'smtp.gmail.com', port: 465, user: 'requests@example.com', pass: 'app pass', from: 'requests@example.com' } } },
    state: st,
    targets: TARGETS,
    ensureEgress: egress,
    openMailbox: async (o) => {
      opened.push(o);
      return {
        examine: async (box) => box === 'INBOX',
        searchSince: async () => messages.map((_, i) => i + 1),
        fetchMessage: async (id) => messages[id - 1],
        logout: async () => {},
      };
    },
    parseMessage: (m) => m,
    isTTY,
    ask: async () => answers.shift() || '',
    log: (l) => out.push(l),
    logReply: (name, outcome) => logged.push([name, outcome]),
  };
  return { deps, logged, out, opened };
}

test('off the VPN nothing connects to the mailbox', async () => {
  const w = world({ egress: async () => { const e = new Error('Not connected through Mullvad'); e.name = 'EgressError'; throw e; } });
  const code = await readEmail({}, w.deps);
  assert.equal(code, 1);
  assert.equal(w.opened.length, 0);
  assert.match(w.out.join('\n'), /Mullvad/);
});

test('a proxy or network.required false is refused: IMAP leaves from this machine', async () => {
  for (const extra of [{ network: { proxy: 'socks5://10.64.0.1:1080' } }, { network: { required: false } }]) {
    const w = world({ config: { email: { smtp: { host: 'smtp.gmail.com', user: 'requests@example.com', pass: 'x', from: 'requests@example.com' } }, ...extra } });
    assert.equal(await readEmail({}, w.deps), 1);
    assert.equal(w.opened.length, 0);
  }
});

test('reads since the first request, from imap.gmail.com, and asks before logging each outcome', async () => {
  const w = world({
    messages: [
      msg({ from: 'Privacy Team at Four Leaf Data <noreply@trustsuperset.com>', fromAddress: 'noreply@trustsuperset.com', text: 'Your request has been completed.' }),
      msg({ fromAddress: 'privacy@pipl.com', text: 'We did not find any profiles in our system.' }),
      msg({ fromAddress: 'support@spokeo.zendesk.com', text: 'Please use our self-service tool at https://www.spokeo.com/optout?ref=mail.', links: ['https://www.spokeo.com/optout?ref=mail'] }),
      msg({ fromAddress: 'no-reply@accounts.google.com', subject: 'Security alert', text: 'App password created' }),
    ],
    answers: ['y', 'n', 'y'],
  });
  assert.equal(await readEmail({}, w.deps), 0);
  assert.equal(w.opened[0].host, 'imap.gmail.com');
  assert.deepEqual(w.logged, [['FourLeaf', 'honored'], ['Spokeo (email)', 'refused']]);
  const out = w.out.join('\n');
  assert.match(out, /Spokeo \(email\) - refused/);
  assert.match(out, /www\.spokeo\.com\/optout/);
  assert.doesNotMatch(out, /ref=mail/, 'links are shown without their query strings');
  assert.match(out, /Other messages \(1\)/);
  assert.match(out, /nothing in the mailbox was changed and no link was opened/i);
});

test('an outcome already logged is not asked again; pending is shown, never asked', async () => {
  const state = { emailSent: { FourLeaf: { at: '2026-10-15T09:00:00Z' }, Pipl: { at: '2026-10-15T09:00:00Z' } }, emailReplies: { FourLeaf: { outcome: 'honored', at: 'x' } } };
  const w = world({ state, messages: [
    msg({ fromAddress: 'noreply@fourleafdata.com', text: 'Your request has been completed.' }),
    msg({ fromAddress: 'privacy@pipl.com', text: 'We have received your request and will process it.' }),
  ], answers: ['y', 'y'] });
  await readEmail({}, w.deps);
  assert.deepEqual(w.logged, []);
  assert.match(w.out.join('\n'), /already logged as honored/);
});

test('without a terminal nothing is logged; the reply commands are printed', async () => {
  const w = world({ isTTY: false, messages: [msg({ fromAddress: 'privacy@pipl.com', text: 'We did not find any profiles.' })] });
  await readEmail({}, w.deps);
  assert.deepEqual(w.logged, []);
  assert.match(w.out.join('\n'), /upec-wipe reply Pipl honored/);
});

test('--since overrides the first-request date; no requests and no --since is an error', async () => {
  const w = world({ state: { emailSent: {}, emailReplies: {} } });
  assert.equal(await readEmail({}, w.deps), 2);
  assert.match(w.out.join('\n'), /--since/);
  const w2 = world({ state: { emailSent: {}, emailReplies: {} } });
  assert.equal(await readEmail({ since: '2026-10-01' }, w2.deps), 0);
  assert.equal(await readEmail({ since: 'yesterday' }, world().deps), 2);
});

test('the read-email mode wires the real pieces and logs through the reply record', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib', 'modes', 'read-email.js'), 'utf8');
  assert.match(src, /ensureNodeEgress\(cfg, \{ fresh: true \}\)/);
  assert.match(src, /require\('\.\.\/imap'\)/);
  assert.match(src, /logReplyFor\(/);
  assert.match(src, /acquireStateLockOrExit\(\)/);
});

test('logReplyFor records the outcome under every person key of that broker', () => {
  const { logReplyFor } = require('../lib/email-step');
  const st = { emailSent: { 'Pipl|Jane Doe': {}, 'Pipl|John Doe': {}, Other: {} } };
  logReplyFor(st, 'Pipl', 'honored', () => 'T');
  assert.deepEqual(Object.keys(st.emailReplies).sort(), ['Pipl|Jane Doe', 'Pipl|John Doe']);
  const st2 = { emailSent: {} };
  logReplyFor(st2, 'Pipl', 'bounced', () => 'T');
  assert.deepEqual(st2.emailReplies, { Pipl: { outcome: 'bounced', at: 'T' } });
});

test('opt-out and form links come before help-desk links; "already logged" sits with its broker', async () => {
  const { linkOrder } = require('../lib/read-email');
  assert.deepEqual(linkOrder(['help.spokeo.com/hc/requests/1', 'help.spokeo.com/requests/automatic-answers/ticket/solve/article/2', 'www.spokeo.com/', 'www.spokeo.com/optout']).slice(0, 2),
    ['www.spokeo.com/optout', 'www.spokeo.com/']);
  const state = { emailSent: { Pipl: { at: '2026-10-15T09:00:00Z' } }, emailReplies: { Pipl: { outcome: 'honored', at: 'x' } } };
  const w = world({ state, messages: [msg({ fromAddress: 'privacy@pipl.com', text: 'We did not find any profiles.' })] });
  await readEmail({}, w.deps);
  assert.match(w.out.join('\n'), /Pipl - honored \(1 message, already logged as honored\)/);
});

// Review 2026-10-15: one message the parser could not read aborted the whole run.
test('a message that cannot be parsed is skipped and counted, the rest are read', async () => {
  const good = msg({ fromAddress: 'privacy@pipl.com', text: 'We did not find any profiles that match.' });
  const w = world({ messages: ['BROKEN', good], isTTY: false });
  w.deps.parseMessage = (m) => { if (m === 'BROKEN') throw new RangeError('bad'); return m; };
  const code = await readEmail({}, w.deps);
  assert.equal(code, 0);
  const out = w.out.join('\n');
  assert.match(out, /Pipl/);
  assert.match(out, /1 message could not be read/);
});

// Review 2026-10-15 (low): a spam From/Subject can decode to ESC/BEL; printed
// raw it could retitle or clear the terminal and hide what is shown.
test('control characters from mail never reach the terminal', async () => {
  const evil = msg({ fromAddress: 'x@spam.example', from: '\u001b]0;pwned\u0007\u001b[2J <x@spam.example>', subject: 'Hi \u009b31m there\u0000' });
  const w = world({ messages: [evil], isTTY: false });
  await readEmail({}, w.deps);
  const out = w.out.join('\n');
  assert.doesNotMatch(out, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  assert.match(out, /Hi .*there/);
});
