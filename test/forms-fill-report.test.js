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

// PrivateRecords 2026-10-11: ticking "Remove My Information" reveals the
// name/city/zip fields a moment later.
function revealingPage() {
  let revealed = false;
  const waits = [];
  const locator = (sel) => {
    const visible = () => sel === '#r-removal' || revealed;
    const self = {
      first: () => self,
      count: async () => 1,
      isVisible: async () => visible(),
      waitFor: async ({ state, timeout }) => { waits.push({ sel, state, timeout }); revealed = true; },
      evaluate: async (fn) => fn({ tagName: 'INPUT', type: sel === '#r-removal' ? 'radio' : 'text' }),
      fill: async () => {}, selectOption: async () => {}, check: async () => {},
    };
    return self;
  };
  return { waits, page: { locator, getByLabel: () => ({ count: async () => 0 }), evaluate: async () => null, $$: async () => [] } };
}

test('after ticking a box, waits briefly for the fields it reveals', async () => {
  const { page, waits } = revealingPage();
  const r = await fillForm(page, { '#r-removal': 'on', '#first': 'Jane' });
  assert.deepEqual(r.filled.map(f => f.selector), ['#r-removal', '#first']);
  assert.equal(waits[0].sel, '#first');
  assert.ok(waits[0].timeout <= 2000);
});

test('without a ticked box first, a hidden field is not waited for', async () => {
  const { page, waits } = revealingPage();
  const r = await fillForm(page, { '#first': 'Jane' });
  assert.deepEqual(r.missed, ['#first']);
  assert.equal(waits.length, 0);
});

// PrivateRecords 2026-10-11: the state dropdown's options are full names.
function namedStatePage(optionValues) {
  const chosen = [];
  const el = {
    first: () => el, count: async () => 1, isVisible: async () => true,
    evaluate: async (fn) => fn({ tagName: 'SELECT', type: 'select-one' }),
    selectOption: async (v) => { const want = typeof v === 'object' ? v.label : v; if (!optionValues.includes(want)) throw new Error('no option'); chosen.push(want); },
  };
  return { chosen, page: { locator: () => el, getByLabel: () => ({ count: async () => 0 }), evaluate: async () => null, $$: async () => [] } };
}

test('a state code fills a dropdown that lists full state names', async () => {
  const { page, chosen } = namedStatePage(['Texas', 'Utah']);
  const r = await fillForm(page, { '#state': 'UT' });
  assert.deepEqual(chosen, ['Utah']);
  assert.equal(r.filled.length, 1);
});

test('a full state name fills a dropdown that lists codes', async () => {
  const { page, chosen } = namedStatePage(['TX', 'UT']);
  await fillForm(page, { '#state': 'Utah' });
  assert.deepEqual(chosen, ['UT']);
});

test('one filled field costs one visibility check and one evaluate before the fill', async () => {
  const calls = [];
  const el = {
    first: () => el,
    count: async () => { calls.push('count'); return 1; },
    isVisible: async () => { calls.push('isVisible'); return true; },
    evaluate: async (fn) => { calls.push('evaluate'); return fn({ tagName: 'INPUT', type: 'text' }); },
    fill: async () => { calls.push('fill'); },
  };
  const page = { locator: () => el };
  const r = await fillForm(page, { 'input[name="firstName"]': 'Jane' });
  assert.equal(r.filled.length, 1);
  assert.deepEqual(calls, ['isVisible', 'evaluate', 'fill']);
});

test('a field that is not on the page is reported missed without an evaluate', async () => {
  const calls = [];
  const el = {
    first: () => el,
    count: async () => { calls.push('count'); return 0; },
    isVisible: async () => { calls.push('isVisible'); return false; },
    evaluate: async () => { calls.push('evaluate'); throw new Error('no element'); },
  };
  const page = { locator: () => el, getByLabel: () => ({ count: async () => 0 }), evaluate: async () => null };
  const r = await fillForm(page, { 'input[name="firstName"]': 'Jane' });
  assert.deepEqual(r.missed, ['input[name="firstName"]']);
  assert.ok(!calls.includes('evaluate'));
});

test('a field revealed by a ticked box is waited for, then filled', async () => {
  let revealed = false;
  let waited = 0;
  const box = { first: () => box, isVisible: async () => true, evaluate: async (fn) => fn({ tagName: 'INPUT', type: 'checkbox' }), check: async () => { revealed = true; } };
  const later = { first: () => later, isVisible: async () => revealed && waited > 0, waitFor: async () => { waited++; }, evaluate: async (fn) => fn({ tagName: 'INPUT', type: 'text' }), fill: async () => {} };
  const page = { locator: (sel) => (sel.includes('consent') ? box : later) };
  const r = await fillForm(page, { 'input[name="consent"]': 'on', 'input[name="firstName"]': 'Jane' });
  assert.equal(waited, 1);
  assert.deepEqual(r.filled.map(f => f.kind), ['checkbox', 'text']);
});
