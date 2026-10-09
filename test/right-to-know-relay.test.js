/**
 * test/right-to-know-relay.test.js
 *
 * Right-to-know requests must use the relay alias in the body, skip blocked
 * persons, and refuse to send From the real address while an alias is in use.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const PERSON = {
  fullName: 'Jane Doe', firstName: 'Jane', lastName: 'Doe', city: 'Austin', state: 'TX',
  zip: '73301', email: 'jane.doe@example.com', phoneFormatted: '(512) 555-0000', country: 'US',
};
const PERSON_2 = {
  fullName: 'John Roe', firstName: 'John', lastName: 'Roe', city: 'Dallas', state: 'TX',
  zip: '75201', email: 'john.roe@example.com', phoneFormatted: '(214) 555-0001', country: 'US',
};
const BROKER = { name: 'Pipl', method: 'email', emailTo: 'removal@pipl.com' };
const SMTP = { host: 'smtp.example.com', port: 587, user: 'u', pass: 'p', from: 'optouts@alias.org' };

const configMod = require('../lib/config');
const loggerMod = require('../lib/logger');

function load() {
  const sent = [];
  const logged = [];
  const origLoad = Module._load;
  Module._load = function (request) {
    if (request === 'nodemailer') {
      return { createTransport: () => ({ sendMail: async (m) => { sent.push(m); return {}; } }) };
    }
    return origLoad.apply(this, arguments);
  };
  const origRecord = configMod.recordKnowRequest;
  const origLog = loggerMod.logResult;
  configMod.recordKnowRequest = () => {};
  loggerMod.logResult = (name, status, detail) => logged.push({ name, status, detail });
  delete require.cache[require.resolve('../lib/right-to-know-runner')];
  const mod = require('../lib/right-to-know-runner');
  return {
    mod, sent, logged,
    restore() {
      Module._load = origLoad;
      configMod.recordKnowRequest = origRecord;
      loggerMod.logResult = origLog;
      delete require.cache[require.resolve('../lib/right-to-know-runner')];
    },
  };
}

test('alias replaces the real email in the know-request body', async () => {
  const h = load();
  try {
    await h.mod.sendKnowRequests([BROKER], { person: PERSON, email: { smtp: SMTP } }, { submissionEmailFor: () => 'alias@simplelogin.com' });
    assert.equal(h.sent.length, 1);
    assert.ok(h.sent[0].text.includes('alias@simplelogin.com'));
    assert.ok(!h.sent[0].text.includes('jane.doe@example.com'));
    assert.equal(h.sent[0].replyTo, 'alias@simplelogin.com');
  } finally { h.restore(); }
});

test('blocked person gets no know request', async () => {
  const h = load();
  try {
    const r = await h.mod.sendKnowRequests([BROKER], { person: PERSON, email: { smtp: SMTP } }, { blockedPersons: new Set([PERSON]) });
    assert.equal(h.sent.length, 0);
    assert.deepEqual(r.sent, []);
  } finally { h.restore(); }
});

test('blocked person in a multi-person config is skipped, the other person still gets a request', async () => {
  const h = load();
  try {
    const cfg = { persons: [PERSON, PERSON_2], email: { smtp: SMTP } };
    const r = await h.mod.sendKnowRequests([BROKER], cfg, { blockedPersons: new Set([PERSON]) });
    assert.equal(h.sent.length, 1, 'only the non-blocked person should get a request');
    assert.ok(h.sent[0].text.includes('John Roe'));
    assert.ok(!h.sent[0].text.includes('Jane Doe'));
    assert.deepEqual(r.sent, ['Pipl']);
  } finally { h.restore(); }
});

test('alias in use + smtp.from is the real email: logged manual, not sent', async () => {
  const h = load();
  try {
    const cfg = { person: PERSON, email: { smtp: { ...SMTP, from: 'jane.doe@example.com' } } };
    const r = await h.mod.sendKnowRequests([BROKER], cfg, { submissionEmailFor: () => 'alias@simplelogin.com' });
    assert.equal(h.sent.length, 0);
    assert.deepEqual(r.manual, ['Pipl']);
    assert.ok(!h.logged.some(l => String(l.detail).includes('jane.doe@example.com')));
  } finally { h.restore(); }
});

test('alias in use + smtp.user is the real email: advice is a separate mailbox, not smtp.from', async () => {
  const h = load();
  try {
    const cfg = { person: PERSON, email: { smtp: { ...SMTP, user: 'jane.doe@example.com' } } };
    const r = await h.mod.sendKnowRequests([BROKER], cfg, { submissionEmailFor: () => 'alias@simplelogin.com' });
    assert.equal(h.sent.length, 0);
    assert.deepEqual(r.manual, ['Pipl']);
    const line = h.logged.map(l => String(l.detail)).join('\n');
    assert.match(line, /separate SMTP mailbox/);
    assert.match(line, /remove the email block/);
    assert.ok(!/Set email\.smtp\.from/.test(line));
    assert.ok(!line.includes('jane.doe@example.com'));
  } finally { h.restore(); }
});

test('alias in use + smtp.from is the real email: advice still says to set a non-real from', async () => {
  const h = load();
  try {
    const cfg = { person: PERSON, email: { smtp: { ...SMTP, from: 'jane.doe@example.com' } } };
    await h.mod.sendKnowRequests([BROKER], cfg, { submissionEmailFor: () => 'alias@simplelogin.com' });
    const line = h.logged.map(l => String(l.detail)).join('\n');
    assert.match(line, /Set email\.smtp\.from to a non-real address/);
  } finally { h.restore(); }
});
