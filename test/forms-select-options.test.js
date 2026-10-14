'use strict';
/**
 * test/forms-select-options.test.js
 *
 * First supervised run, 2026-10-14: SocialCatfish and PrivateRecords list US
 * states by full name. fillForm tried selectOption({label:'UT'}) and
 * selectOption('UT') first; Playwright waits up to its timeout for an option
 * that never appears, so each select cost 60-120 s, the page moved on, and the
 * state and the fields it reveals were reported "not found". fillForm now reads
 * the options and selects a matching one directly, or gives up at once.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fillForm } = require('../lib/forms');

function selectPage(options, calls) {
  const node = { tagName: 'SELECT', type: 'select-one', options };
  return {
    locator: () => ({
      first: () => ({
        count: async () => 1,
        isVisible: async () => true,
        evaluate: async (fn) => fn(node),
        // An option that is not there makes Playwright wait; never resolve.
        selectOption: (arg) => {
          calls.push(arg);
          const v = arg && typeof arg === 'object' ? (arg.value ?? arg.label) : arg;
          return options.some(o => o.value === v || o.label === v) ? Promise.resolve() : new Promise(() => {});
        },
      }),
    }),
    getByLabel: () => ({ first: () => ({ count: async () => 0 }) }),
    evaluate: async () => {},
  };
}

const STATES = [{ value: '', label: 'Select your state', text: 'Select your state' },
  { value: 'Texas', label: 'Texas', text: 'Texas' }, { value: 'Utah', label: 'Utah', text: 'Utah' }];

test('a state code picks the full-name option directly, without waiting on "UT"', async () => {
  const calls = [];
  const r = await fillForm(selectPage(STATES, calls), { '#state': 'UT' }, { country: 'US', state: 'UT' });
  assert.deepEqual(r.filled.map(f => f.selector), ['#state']);
  assert.deepEqual(calls, [{ value: 'Utah' }]);
});

test('option text is matched without regard to case', async () => {
  const calls = [];
  const opts = [{ value: 'ut', label: 'UTAH', text: 'UTAH' }];
  const r = await fillForm(selectPage(opts, calls), { '#state': 'Utah' }, { country: 'US', state: 'UT' });
  assert.equal(r.filled.length, 1);
  assert.deepEqual(calls, [{ value: 'ut' }]);
});

test('no matching option: nothing is selected and nothing waits', async () => {
  const calls = [];
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(String(m));
  try {
    const opts = [{ value: '', label: 'Select', text: 'Select' }, { value: 'Texas', label: 'Texas', text: 'Texas' }];
    const r = await fillForm(selectPage(opts, calls), { '#state': 'UT' }, { country: 'US', state: 'UT' });
    assert.equal(r.filled.length, 0);
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(calls, []);
  assert.ok(warnings.some(w => /select unmatched/.test(w)));
});
