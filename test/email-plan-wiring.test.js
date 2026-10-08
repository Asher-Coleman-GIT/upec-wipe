/**
 * test/email-plan-wiring.test.js
 *
 * C1 (final review): email opt-outs run once per run with the submission
 * plan's alias resolver and blocked set (submissionOptions). A blocked person
 * gets no mail, an allowed person's mail carries only the alias, and a person
 * with no alias while a relay is configured is skipped instead of falling back
 * to the real email. Log lines name only "person #N". nodemailer is stubbed via
 * Module._load so no SMTP connection is made.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { buildSubmissionPlan, submissionOptions } = require('../lib/submission-plan');
const configMod = require('../lib/config');
const loggerMod = require('../lib/logger');

const A = {
  firstName: 'Alice', lastName: 'Adams', fullName: 'Alice Adams', city: 'Austin', state: 'TX',
  zip: '73301', email: 'alice.real@example.com', phone: '5125550001', phoneFormatted: '(512) 555-0001',
};
const B = {
  firstName: 'Bob', lastName: 'Brown', fullName: 'Bob Brown', city: 'Denver', state: 'CO',
  zip: '80201', email: 'bob.real@example.com', phone: '3035550002', phoneFormatted: '(303) 555-0002',
};
const BROKER = { name: 'Pipl', method: 'email', emailTo: 'removal@pipl.com' };
const SMTP = { host: 'smtp.example.net', port: 587, user: 'separate@example.net', pass: 'pw', from: 'separate@example.net' };
const RELAY = { provider: 'simplelogin', apiKey: 'sl-key' };

const orig = {
  last: configMod.lastOptOutDaysAgo,
  rec: configMod.recordSuccess,
  log: loggerMod.logResult,
};

function setup({ lastOptOut } = {}) {
  const logged = [];
  const lastCalls = [];
  configMod.lastOptOutDaysAgo = (k) => { lastCalls.push(k); return lastOptOut ? lastOptOut(k) : 999; };
  configMod.recordSuccess = () => {};
  loggerMod.logResult = (name, status, detail) => logged.push({ name, status, detail });

  const sent = [];
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'nodemailer') {
      return { createTransport: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } }) };
    }
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve('../lib/email')];
  const email = require('../lib/email');
  const restore = () => {
    Module._load = origLoad;
    delete require.cache[require.resolve('../lib/email')];
    configMod.lastOptOutDaysAgo = orig.last;
    configMod.recordSuccess = orig.rec;
    loggerMod.logResult = orig.log;
  };
  return { email, sent, logged, lastCalls, restore };
}

const mailText = (m) => JSON.stringify(m);

test('real wiring: blocked person gets no mail, allowed person mail carries only the alias', async () => {
  const { email, sent, logged, restore } = setup();
  try {
    const config = { persons: [A, B], relay: RELAY, email: { smtp: SMTP } };
    let n = 0;
    const createImpl = async () => { n += 1; if (n === 1) throw new Error('HTTP 500'); return 'bob-alias@simplelogin.com'; };
    const plan = await buildSubmissionPlan({ config, persons: config.persons, state: {}, createImpl });
    assert.equal(plan.blocked[0].person, A);

    await email.sendOptOutEmails([BROKER], config, 'linux', submissionOptions(plan));

    assert.equal(sent.length, 1, 'exactly one mail: the allowed person only');
    const m = sent[0];
    assert.equal(m.replyTo, 'bob-alias@simplelogin.com');
    assert.ok(m.text.includes('bob-alias@simplelogin.com'));
    for (const real of [A.email, B.email]) assert.ok(!mailText(m).includes(real), `mail must not contain ${real}`);
    assert.ok(!mailText(m).includes('Alice'), 'blocked person absent from the mail');

    const skip = logged.find(l => l.status === 'skipped');
    assert.ok(skip, 'blocked person is logged as skipped');
    assert.match(skip.detail, /person #1/);
    for (const l of logged) {
      for (const pii of [A.email, B.email, 'Alice', 'Adams', 'Bob', 'Brown']) assert.ok(!l.detail.includes(pii), `log leaks ${pii}`);
    }
  } finally { restore(); }
});

test('relay configured and the resolver returns nothing: person skipped, never the real email', async () => {
  const { email, sent, logged, restore } = setup();
  try {
    const config = { persons: [A, B], relay: RELAY, email: { smtp: SMTP } };
    await email.sendOptOutEmails([BROKER], config, 'linux', {
      submissionEmailFor: (p) => (p === B ? 'bob-alias@simplelogin.com' : undefined),
    });
    assert.equal(sent.length, 1);
    assert.ok(!mailText(sent[0]).includes(A.email));
    assert.ok(!mailText(sent[0]).includes(B.email));
    const m = logged.find(l => l.status === 'manual');
    assert.ok(m, 'unresolved person logged as manual');
    assert.match(m.detail, /person #1/);
    assert.ok(!m.detail.includes(A.email) && !m.detail.includes('Alice'));
  } finally { restore(); }
});

test('relay required but unusable and resolver returns nothing: skipped', async () => {
  const { email, sent, restore } = setup();
  try {
    const config = { person: A, relay: { provider: 'simplelogin', apiKey: '', required: true }, email: { smtp: SMTP } };
    await email.sendOptOutEmails([BROKER], config, 'linux', { submissionEmailFor: () => undefined });
    assert.equal(sent.length, 0);
  } finally { restore(); }
});

test('blockedPersons is honoured even without a relay', async () => {
  const { email, sent, restore } = setup();
  try {
    const config = { persons: [A, B], email: { smtp: SMTP } };
    await email.sendOptOutEmails([BROKER], config, 'linux', { blockedPersons: new Set([A]) });
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes(B.email));
    assert.ok(!mailText(sent[0]).includes(A.email));
  } finally { restore(); }
});

test('no relay configured and not required: upstream behaviour, real email used', async () => {
  const { email, sent, restore } = setup();
  try {
    const config = { persons: [A, B], email: { smtp: SMTP } };
    const plan = await buildSubmissionPlan({ config, persons: config.persons, state: {} });
    await email.sendOptOutEmails([BROKER], config, 'linux', submissionOptions(plan));
    assert.equal(sent.length, 2);
    assert.ok(sent[0].text.includes(A.email));
    assert.ok(sent[1].text.includes(B.email));
  } finally { restore(); }
});

test('recent-send dedupe is per person in multi-person mode', async () => {
  const { email, sent, lastCalls, restore } = setup({ lastOptOut: (k) => (k === 'Pipl|Alice Adams' ? 1 : 999) });
  try {
    const config = { persons: [A, B], email: { smtp: SMTP } };
    await email.sendOptOutEmails([BROKER], config, 'linux');
    assert.deepEqual(lastCalls, ['Pipl|Alice Adams', 'Pipl|Bob Brown']);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes(B.email));
  } finally { restore(); }
});

test('dryRun sends nothing', async () => {
  const { email, sent, logged, restore } = setup();
  try {
    const config = { person: A, email: { smtp: SMTP } };
    await email.sendOptOutEmails([BROKER], config, 'linux', { dryRun: true });
    assert.equal(sent.length, 0);
    assert.ok(logged.some(l => l.status === 'skipped' && /preview/.test(l.detail)));
  } finally { restore(); }
});
