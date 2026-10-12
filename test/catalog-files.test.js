// test/catalog-files.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { validateRecord, CATALOG_DIR } = require('../lib/catalog');

const files = fs.existsSync(CATALOG_DIR) ? fs.readdirSync(CATALOG_DIR).filter(f => f.endsWith('.json') && f !== 'candidates.json') : [];
const example = require('../config.example.json');
const person = example.person || (example.persons || [])[0] || {};
const pii = ['firstName', 'lastName', 'city', 'zip', 'phone', 'email', 'dob'].map(k => person[k]).filter(v => typeof v === 'string' && v.length >= 4);
const typedOnly = ['zip', 'phone', 'email'].map(k => person[k]).filter(v => typeof v === 'string' && v.length >= 4);

test('every tracked catalog record validates', () => {
  for (const f of files) assert.equal(validateRecord(JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8')), f), null, f);
});

test('no catalog record holds personal values; email addresses only in survey.contacts', () => {
  for (const f of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'));
    // review.to is an address by design; validateRecord pins it to survey.contacts.
    const review = rec.review && rec.review.state === 'email' ? { ...rec.review, to: '' } : rec.review;
    const text = JSON.stringify({ ...rec, survey: { ...(rec.survey || {}), contacts: [] }, review });
    // The review is written by hand: no person value at all. The survey is the
    // site's own text, where "Jane" or "Austin" occur by themselves (sample
    // placeholders, a company address), so it is held to the values only typing
    // could put there.
    const reviewText = JSON.stringify(rec.review || {});
    for (const v of pii) assert.ok(!reviewText.includes(v), `${f} review contains a config.example.json person value`);
    for (const v of typedOnly) assert.ok(!text.includes(v), `${f} contains a config.example.json person value`);
    assert.doesNotMatch(text, /[\w.+-]+@[\w-]+\.[\w.-]+/, `${f} has an email address outside survey.contacts`);
  }
});

test('the batch helper and the review guide exist', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'catalog-batch.js')));
  const guide = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CATALOG-REVIEW.md'), 'utf8');
  for (const s of ['ASSIST=1', 'catalog-batch', 'preview --only', 'needs-review', '{firstName}', '"state": "email"']) assert.ok(guide.includes(s), s);
});
