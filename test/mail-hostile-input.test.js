'use strict';
/**
 * test/mail-hostile-input.test.js
 *
 * Review 2026-10-15: read-email parses untrusted mail. One numeric entity out
 * of range (&#99999999;) threw and aborted the whole read, and crafted bodies
 * made htmlToText and classifyReply take seconds per message (quadratic regexes).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMessage, htmlToText } = require('../lib/mime');
const { classifyReply } = require('../lib/reply-classify');

const raw = (ct, body) => Buffer.from(`From: x@spam.example\r\nSubject: hi\r\nContent-Type: ${ct}\r\n\r\n${body}`);
const fast = (fn, ms = 1500) => { const t = Date.now(); fn(); return Date.now() - t < ms; };

test('an out-of-range or surrogate numeric entity does not throw', () => {
  const m = parseMessage(raw('text/html', '<p>a &#99999999; b &#xD800; c &#65; d</p>'));
  assert.match(m.text, /a .* b .* c A d/);
});

test('htmlToText stays fast on 200 KB of unclosed tags', () => {
  for (const body of ['<'.repeat(200000), '<style'.repeat(33000), '<a'.repeat(100000), '<script x'.repeat(22000)]) {
    assert.ok(fast(() => htmlToText(body)), `slow on ${body.slice(0, 9)}...`);
  }
});

test('htmlToText still strips blocks, tags and entities', () => {
  assert.equal(htmlToText('<style>p{}</style><p>Hi&nbsp;<b>there</b></p><script>x()</script>ok &amp; done'), 'Hi there\nok & done');
});

test('classifyReply stays fast on 200 KB of repeated trigger phrases', () => {
  for (const phrase of ['please use ', 'unable to accept ', 'do not hold any data ', 'verify your identity ']) {
    const text = phrase.repeat(Math.ceil(200000 / phrase.length));
    assert.ok(fast(() => classifyReply({ text, subject: 'x' })), `slow on "${phrase.trim()}"`);
  }
});

test('classifyReply still reads a refusal', () => {
  assert.equal(classifyReply({ text: 'We are unable to accept requests by email. Please use our web form at https://x.example/form.' }).outcome, 'refused');
});
