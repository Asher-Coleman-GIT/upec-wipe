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

// Final review 2026-10-10: a swallowed fill failure must not be reported as a
// fill, or the empty-form guard passes a form that is still empty.
function failingPage({ directTag = 'input', directType = 'text', directPresent = false, label = null } = {}) {
  const direct = {
    first: () => direct,
    count: async () => (directPresent ? 1 : 0),
    isVisible: async () => directPresent,
    evaluate: async (fn) => fn({ tagName: directTag.toUpperCase(), type: directType }),
    fill: async () => { throw new Error('fill failed'); },
    selectOption: async () => { throw new Error('no such option'); },
    check: async () => { throw new Error('check failed'); },
  };
  const labelled = label && {
    first: () => labelled,
    count: async () => 1,
    evaluate: async (fn) => fn({ tagName: label.tag.toUpperCase(), type: label.type || '' }),
    fill: async () => { throw new Error('Element is not an <input>'); },
    selectOption: async () => { throw new Error('no such option'); },
    check: async () => { throw new Error('check failed'); },
  };
  return {
    locator: () => direct,
    getByLabel: () => labelled || { count: async () => 0, first: () => ({}) },
    evaluate: async () => null,
    $$: async () => [],
  };
}

test('a select whose option cannot be chosen is missed, not filled', async () => {
  const r = await fillForm(failingPage({ directPresent: true, directTag: 'select' }), { 'select[name="state"]': 'TX' });
  assert.deepEqual(r.filled, []);
  assert.deepEqual(r.missed, ['select[name="state"]']);
});

test('a text fill that throws is missed, not filled', async () => {
  const r = await fillForm(failingPage({ directPresent: true }), { '#first': 'Jane' });
  assert.deepEqual(r.filled, []);
  assert.deepEqual(r.missed, ['#first']);
});

test('a label match on a select that cannot take the value is missed, not reported as text', async () => {
  const r = await fillForm(failingPage({ label: { tag: 'select' } }), { 'select[name*="state" i]': 'TX' });
  assert.deepEqual(r.filled, []);
  assert.deepEqual(r.missed, ['select[name*="state" i]']);
});

test('a label match on a checkbox is never typed into or counted as text', async () => {
  const r = await fillForm(failingPage({ label: { tag: 'input', type: 'checkbox' } }), { 'input[name*="email" i]': 'jane@example.com' });
  assert.equal(r.filled.filter(f => f.kind === 'text').length, 0);
});
