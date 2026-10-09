/**
 * test/smtp-tls.test.js
 *
 * Audit M5 (follow-up C1 item 6). Both SMTP paths built their transport with
 * `secure: port === 465` and nothing else, so on 587 nodemailer upgraded only
 * if the server advertised STARTTLS. An on-path attacker could strip it and
 * read the AUTH credentials and the PII mail bodies.
 *
 * One shared helper (lib/email.js smtpTransportOptions) now builds the options:
 * requireTLS + TLS 1.2 minimum whenever secure is false, and TLS 1.2 minimum
 * on 465 too. Both send paths are checked with nodemailer stubbed.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const configMod = require('../lib/config');
const loggerMod = require('../lib/logger');

const SMTP = { host: 'smtp.example.com', user: 'box@example.com', pass: 'pw', from: 'box@example.com' };

test('smtpTransportOptions: port 587 requires STARTTLS with TLS 1.2 minimum', () => {
  const { smtpTransportOptions } = require('../lib/email');
  const o = smtpTransportOptions({ ...SMTP, port: 587 });
  assert.equal(o.host, 'smtp.example.com');
  assert.equal(o.port, 587);
  assert.equal(o.secure, false);
  assert.equal(o.requireTLS, true);
  assert.deepEqual(o.tls, { minVersion: 'TLSv1.2' });
  assert.deepEqual(o.auth, { user: 'box@example.com', pass: 'pw' });
});

test('smtpTransportOptions: no port defaults to 587 with requireTLS', () => {
  const { smtpTransportOptions } = require('../lib/email');
  const o = smtpTransportOptions({ ...SMTP });
  assert.equal(o.port, 587);
  assert.equal(o.secure, false);
  assert.equal(o.requireTLS, true);
  assert.equal(o.tls.minVersion, 'TLSv1.2');
});

test('smtpTransportOptions: any non-465 port requires TLS', () => {
  const { smtpTransportOptions } = require('../lib/email');
  for (const port of [25, 2525, 1025]) {
    const o = smtpTransportOptions({ ...SMTP, port });
    assert.equal(o.secure, false);
    assert.equal(o.requireTLS, true, String(port));
    assert.equal(o.tls.minVersion, 'TLSv1.2');
  }
});

test('smtpTransportOptions: port 465 is implicit TLS with TLS 1.2 minimum', () => {
  const { smtpTransportOptions } = require('../lib/email');
  for (const port of [465, '465']) {
    const o = smtpTransportOptions({ ...SMTP, port });
    assert.equal(o.secure, true, String(port));
    assert.deepEqual(o.tls, { minVersion: 'TLSv1.2' });
  }
});

function withNodemailerStub(fn) {
  const transports = [];
  const origLoad = Module._load;
  const orig = { rec: configMod.recordSuccess, log: loggerMod.logResult, last: configMod.lastOptOutDaysAgo, know: configMod.recordKnowRequest };
  configMod.recordSuccess = () => {};
  configMod.recordKnowRequest = () => {};
  configMod.lastOptOutDaysAgo = () => 999;
  loggerMod.logResult = () => {};
  Module._load = function (request) {
    if (request === 'nodemailer') {
      return { createTransport: (opts) => { transports.push(opts); return { sendMail: async () => ({ messageId: 'x' }) }; } };
    }
    return origLoad.apply(this, arguments);
  };
  const restore = () => {
    Module._load = origLoad;
    configMod.recordSuccess = orig.rec;
    configMod.recordKnowRequest = orig.know;
    configMod.lastOptOutDaysAgo = orig.last;
    loggerMod.logResult = orig.log;
  };
  return Promise.resolve().then(() => fn(transports)).finally(restore);
}

test('opt-out email path builds its transport with requireTLS', async () => {
  await withNodemailerStub(async (transports) => {
    const email = require('../lib/email');
    await email._sendViaSMTP({ name: 'B', emailTo: 'privacy@broker.example' },
      { firstName: 'A', lastName: 'B', email: 'a@example.com', country: 'US' }, { ...SMTP, port: 587 }, undefined, 1);
    assert.equal(transports.length, 1);
    assert.equal(transports[0].requireTLS, true);
    assert.equal(transports[0].tls.minVersion, 'TLSv1.2');
  });
});

test('right-to-know path builds its transport with requireTLS', async () => {
  await withNodemailerStub(async (transports) => {
    const rtk = require('../lib/right-to-know-runner');
    await rtk._sendViaSMTP({ name: 'B', emailTo: 'privacy@broker.example' },
      { subject: 's', body: 'b' }, { ...SMTP, port: 587 });
    assert.equal(transports.length, 1);
    assert.equal(transports[0].requireTLS, true);
    assert.equal(transports[0].tls.minVersion, 'TLSv1.2');
  });
});
