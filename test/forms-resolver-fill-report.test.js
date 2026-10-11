/**
 * test/forms-resolver-fill-report.test.js
 *
 * The semantic resolver's fill/select/check used to be fire-and-forget, so a
 * failed action was still reported as filled and could satisfy the empty-form
 * guard. A failed resolver action must land in `missed`.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const originalLoad = Module._load.bind(Module);
let resolved = null;
Module._load = function (request, parent, isMain) {
  if (parent?.filename?.endsWith('forms.js') && request === './field-resolver') {
    return { resolveField: async () => resolved, clearResolveMarker: async () => {} };
  }
  return originalLoad(request, parent, isMain);
};
delete require.cache[require.resolve('../lib/forms')];
const { fillForm } = require('../lib/forms');
Module._load = originalLoad;

const noDirect = {
  locator: () => { const l = { first: () => l, count: async () => 0, isVisible: async () => false }; return l; },
  getByLabel: () => ({ count: async () => 0, first: () => ({}) }),
};
function el(tag, type, ok) {
  const fail = async () => { throw new Error('action failed'); };
  return {
    evaluate: async (fn) => fn({ tagName: tag.toUpperCase(), type }),
    fill: ok ? async () => {} : fail,
    selectOption: ok ? async () => {} : fail,
    check: ok ? async () => {} : fail,
  };
}

test('a resolver fill that throws is missed', async () => {
  resolved = el('input', 'text', false);
  const r = await fillForm(noDirect, { 'input[name="email"]': 'jane@example.com' });
  assert.deepEqual(r.filled, []);
  assert.deepEqual(r.missed, ['input[name="email"]']);
});

test('a resolver select that cannot take the value is missed', async () => {
  resolved = el('select', 'select-one', false);
  const r = await fillForm(noDirect, { 'select[name="state"]': 'TX' });
  assert.deepEqual(r.missed, ['select[name="state"]']);
});

test('a resolver fill that works is reported with its real kind', async () => {
  resolved = el('select', 'select-one', true);
  const r = await fillForm(noDirect, { 'select[name="state"]': 'TX' });
  assert.equal(r.filled[0].kind, 'select');
});
