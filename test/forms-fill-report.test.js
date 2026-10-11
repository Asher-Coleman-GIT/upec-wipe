// test/forms-fill-report.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fillForm } = require('../lib/forms');

function stubPage({ present = [], types = {} } = {}) {
  const locator = (sel) => {
    const self = {
      first: () => self,
      count: async () => (present.includes(sel) ? 1 : 0),
      isVisible: async () => present.includes(sel),
      evaluate: async (fn) => fn({ tagName: 'INPUT', type: types[sel] || 'text' }),
      fill: async () => {}, selectOption: async () => {}, check: async () => {},
    };
    return self;
  };
  return {
    locator,
    getByLabel: () => ({ count: async () => 0, first: () => ({ fill: async () => {} }) }),
    evaluate: async () => null, // semantic resolver finds nothing
    $$: async () => [],
  };
}

test('fillForm reports filled and missed selectors', async () => {
  const r = await fillForm(stubPage({ present: ['#first'] }), { '#first': 'Jane', '#last': 'Doe' });
  assert.deepEqual(r.filled.map(f => f.selector), ['#first']);
  assert.equal(r.filled[0].value, 'Jane');
  assert.equal(r.filled[0].kind, 'text');
  assert.deepEqual(r.missed, ['#last']);
});
test('a checkbox fill is reported with kind checkbox', async () => {
  const r = await fillForm(stubPage({ present: ['#agree'], types: { '#agree': 'checkbox' } }), { '#agree': 'on' });
  assert.equal(r.filled[0].kind, 'checkbox');
});
test('empty values are neither filled nor missed', async () => {
  const r = await fillForm(stubPage(), { '#middle': '' });
  assert.deepEqual(r, { filled: [], missed: [] });
});
