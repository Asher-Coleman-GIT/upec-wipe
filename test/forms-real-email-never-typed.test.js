/**
 * test/forms-real-email-never-typed.test.js
 *
 * 2026-10-10 live preview: SearchPeopleFree's '#o_email' selector was not
 * recognised as an email field ("_" defeats the \bemail\b test), so the
 * member's REAL email went into the form instead of the relay alias. The swap
 * must not depend on how a broker names its field.
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fillForm } = require('../lib/forms');

const PERSON = { firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', state: 'TX', city: 'Austin', zip: '73301', email: 'jane.real@example.com', country: 'US' };
const ALIAS = 'alias123@relay.example';

function recordingPage() {
  const typed = [];
  const locator = (sel) => {
    const self = {
      first: () => self,
      count: async () => 1,
      isVisible: async () => true,
      evaluate: async (fn) => fn({ tagName: 'INPUT', type: 'text' }),
      fill: async (v) => { typed.push(v); },
      selectOption: async (v) => { typed.push(typeof v === 'object' ? v.label : v); },
      check: async () => {},
    };
    return self;
  };
  return { typed, locator, getByLabel: () => ({ count: async () => 0, first: () => ({}) }) };
}

test('an oddly named email field still gets the alias', async () => {
  const page = recordingPage();
  await fillForm(page, { '#o_email': PERSON.email }, PERSON, ALIAS);
  assert.deepEqual(page.typed, [ALIAS]);
});

test('no broker in brokers.js ever types the real email when an alias is set', async () => {
  const brokers = require('../brokers').forPerson(PERSON);
  for (const b of brokers) {
    if (!b.formFields) continue;
    const page = recordingPage();
    await fillForm(page, b.formFields, PERSON, ALIAS);
    assert.ok(!page.typed.includes(PERSON.email), `${b.name} typed the real email`);
  }
});
