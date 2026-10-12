'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { confirmBreachCheck } = require('../lib/hibp');
const { modeSource } = require('./helpers/watcher-source');

function io(answer, isTTY = true) {
  const lines = [];
  let asked = 0;
  return { lines, get asked() { return asked; }, args: { emails: ['jane.doe@example.com'], isTTY, ask: async () => { asked++; return answer; }, log: l => lines.push(l) } };
}

test('no interactive terminal: refused without asking', async () => {
  const x = io('YES', false);
  assert.equal(await confirmBreachCheck(x.args), false);
  assert.equal(x.asked, 0);
  assert.match(x.lines.join('\n'), /interactive terminal/);
});

test('only YES continues, after saying the real address goes to haveibeenpwned.com', async () => {
  const yes = io('YES');
  assert.equal(await confirmBreachCheck(yes.args), true);
  assert.match(yes.lines.join('\n'), /haveibeenpwned\.com/);
  for (const a of ['yes', 'y', '', 'SEND']) assert.equal(await confirmBreachCheck(io(a).args), false);
});

test('watcher asks before running the breach check', () => {
  const src = modeSource('breach');
  const i = src.indexOf('confirmBreachCheck(');
  assert.ok(i > 0);
  assert.ok(i < src.indexOf('await runBreachCheck('));
});
