'use strict';
/**
 * test/mime.test.js - lib/mime.js decodes the broker replies read-email shows.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMessage, htmlToText } = require('../lib/mime');

const raw = (s) => Buffer.from(s.replace(/\n/g, '\r\n'), 'latin1');

test('headers: folded lines and encoded-word subjects are decoded', () => {
  const m = parseMessage(raw('From: "Privacy Team" <privacy@broker.example>\nSubject: =?UTF-8?B?Q29uZmlybWF0aW9uOiBkb25l?=\n =?UTF-8?Q?_=E2=80=93_thanks?=\nDate: Thu, 15 Oct 2026 10:00:00 +0000\n\nHello'));
  assert.equal(m.from, '"Privacy Team" <privacy@broker.example>');
  assert.equal(m.fromAddress, 'privacy@broker.example');
  assert.equal(m.subject, 'Confirmation: done \u2013 thanks');
  assert.equal(m.date.toISOString(), '2026-10-15T10:00:00.000Z');
  assert.equal(m.text, 'Hello');
});

test('multipart/alternative with quoted-printable text and base64 html', () => {
  const html = Buffer.from('<p>Your request <b>has been completed</b>.</p><a href="https://broker.example/privacy?x=1">Privacy</a>').toString('base64');
  const m = parseMessage(raw([
    'From: privacy@broker.example', 'Subject: Done', 'Content-Type: multipart/alternative; boundary="b1"', '',
    '--b1', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '',
    'Dear Jane, your request has been compl=', 'eted =E2=80=94 thank you.',
    '--b1', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', html,
    '--b1--', '',
  ].join('\n')));
  assert.equal(m.text.trim(), 'Dear Jane, your request has been completed \u2014 thank you.');
  assert.match(m.html, /has been completed/);
  assert.deepEqual(m.links, ['https://broker.example/privacy?x=1']);
});

test('nested multipart and latin-1 text; attachments are skipped', () => {
  const m = parseMessage(raw([
    'From: x@broker.example', 'Content-Type: multipart/mixed; boundary=outer', '',
    '--outer', 'Content-Type: multipart/alternative; boundary=inner', '',
    '--inner', 'Content-Type: text/plain; charset=iso-8859-1', 'Content-Transfer-Encoding: quoted-printable', '', 'Caf=E9 privacy team', '--inner--',
    '--outer', 'Content-Type: application/pdf; name=a.pdf', 'Content-Disposition: attachment; filename=a.pdf', 'Content-Transfer-Encoding: base64', '', 'JVBERi0=', '--outer--', '',
  ].join('\n')));
  assert.equal(m.text.trim(), 'Café privacy team');
});

test('html-only mail becomes readable text without scripts or styles', () => {
  assert.equal(htmlToText('<style>p{}</style><p>Use&nbsp;our <a href="x">form</a>.</p><script>x()</script>'), 'Use our form.');
});

test('a truncated message (read-email fetches the first 200 KB) still parses', () => {
  const m = parseMessage(raw('From: x@broker.example\nContent-Type: multipart/alternative; boundary=b\n\n--b\nContent-Type: text/plain\n\nPartial text'));
  assert.equal(m.text.trim(), 'Partial text');
});

// 2026-10-15 live run: five replies were html-only, so read-email saw no text.
test('an html-only message gets its text from the html', () => {
  const m = parseMessage(raw('From: x@broker.example\nContent-Type: text/html; charset=utf-8\n\n<p>We did not find any profiles in our system.</p>'));
  assert.equal(m.text, 'We did not find any profiles in our system.');
});
