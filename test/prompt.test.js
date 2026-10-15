'use strict';
// Setup prompts: a secret is read up to Enter, never echoed, and leaves
// nothing behind for the next question.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { createPrompter } = require('../lib/prompt');

function harness() {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = '';
  output.on('data', d => { shown += d.toString(); });
  const p = createPrompter({ input, output, terminal: true });
  return { input, p, shown: () => shown };
}

// One chunk per keystroke, as a terminal sends typed input.
const type = (input, s) => { for (const ch of s) input.write(ch); };

test('a typed secret is read whole, not just its first keystroke', async () => {
  const h = harness();
  const pending = h.p.askSecret('App password');
  type(h.input, 'abcdefgh\n');
  assert.equal(await pending, 'abcdefgh');
  h.p.close();
});

test('a secret is never echoed', async () => {
  const h = harness();
  const pending = h.p.askSecret('App password');
  type(h.input, 'topsecretvalue\n');
  await pending;
  h.p.close();
  assert.match(h.shown(), /App password: /);
  assert.doesNotMatch(h.shown(), /topsecret|secretvalue/);
});

test('a pasted secret with spaces is kept, trimmed only at the ends', async () => {
  const h = harness();
  const pending = h.p.askSecret('App password');
  h.input.write('  abcd efgh ijkl mnop \n');
  assert.equal(await pending, 'abcd efgh ijkl mnop');
  h.p.close();
});

test('the next question gets only its own answer', async () => {
  const h = harness();
  const secret = h.p.askSecret('App password');
  type(h.input, 'abcdefgh\n');
  await secret;
  const next = h.p.ask('Browser profile directory', '/default/dir');
  type(h.input, '\n');
  assert.equal(await next, '/default/dir');
  h.p.close();
});

test('ask echoes the answer and falls back to the default', async () => {
  const h = harness();
  const a = h.p.ask('City', 'Exampleton');
  type(h.input, 'Springfield\n');
  assert.equal(await a, 'Springfield');
  const b = h.p.ask('City', 'Exampleton');
  type(h.input, '\n');
  assert.equal(await b, 'Exampleton');
  h.p.close();
  assert.match(h.shown(), /City \[Exampleton\]: /);
});
