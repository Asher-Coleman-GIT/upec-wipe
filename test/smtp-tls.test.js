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
 * on 465 too. The shared email transport call is pinned in test/watcher-know-step.test.js.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

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
