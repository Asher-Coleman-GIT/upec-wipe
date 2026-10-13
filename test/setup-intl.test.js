/**
 * test/setup-intl.test.js
 *
 * Unit tests for the pure helper functions exported from setup.js:
 *   regionPrompts(country)  - returns correct label strings per country
 *
 * No readline/stdin interaction is exercised here.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// setup.js exports helpers at module level without starting main()
const { regionPrompts } = require('../setup');

// ── regionPrompts ─────────────────────────────────────────────────────────────

test('regionPrompts: US returns "State (2-letter)" and "ZIP code"', () => {
  const { regionLabel, postalLabel } = regionPrompts('US');
  assert.equal(regionLabel, 'State (2-letter)');
  assert.equal(postalLabel, 'ZIP code');
});

test('regionPrompts: CA returns province/region and postal labels', () => {
  const { regionLabel, postalLabel } = regionPrompts('CA');
  assert.ok(regionLabel.toLowerCase().includes('province') || regionLabel.toLowerCase().includes('region'),
    `expected province/region label, got "${regionLabel}"`);
  assert.ok(postalLabel.toLowerCase().includes('postal'),
    `expected postal label, got "${postalLabel}"`);
});

test('regionPrompts: GB returns province/region and postal labels', () => {
  const { regionLabel, postalLabel } = regionPrompts('GB');
  assert.ok(regionLabel.toLowerCase().includes('province') || regionLabel.toLowerCase().includes('region'),
    `expected province/region label for GB, got "${regionLabel}"`);
  assert.ok(postalLabel.toLowerCase().includes('postal'),
    `expected postal label for GB, got "${postalLabel}"`);
});

test('regionPrompts: AU returns province/region and postal labels', () => {
  const { regionLabel } = regionPrompts('AU');
  assert.ok(regionLabel.toLowerCase().includes('province') || regionLabel.toLowerCase().includes('region'),
    `expected province/region label for AU, got "${regionLabel}"`);
});

test('regionPrompts: unknown country returns non-US labels', () => {
  const { regionLabel, postalLabel } = regionPrompts('ZZ');
  // Any non-US country must NOT return State/ZIP labels
  assert.notEqual(regionLabel, 'State (2-letter)', 'unknown country must not use US region label');
  assert.notEqual(postalLabel, 'ZIP code',          'unknown country must not use ZIP label');
});
