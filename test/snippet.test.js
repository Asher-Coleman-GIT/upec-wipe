const { test } = require('node:test');
const assert = require('node:assert/strict');
const { snippetAround } = require('../lib/snippet');
const { classifyPostSubmit } = require('../lib/success');
const { detectConfirmationRequired } = require('../lib/confirm');

const PAGE = 'Your request has been processed. You will also receive a confirmation email. ' +
  'Please allow 3 days for your record to be fully removed from our site. Note: Omitting information may delay it.';

test('snippetAround starts and ends on whole words, marking cut ends', () => {
  const at = PAGE.indexOf('You will');
  const s = snippetAround(PAGE, at, 20, 60);
  assert.match(s, /^\.\.\. /);
  assert.match(s, / \.\.\.$/);
  for (const w of s.replace(/^\.\.\. | \.\.\.$/g, '').split(' ')) assert.ok(PAGE.split(/\s+/).includes(w), `"${w}" is a cut word`);
});

test('snippetAround has no markers when the whole text fits', () => {
  assert.equal(snippetAround('Thanks,   request  received.', 0, 30, 120), 'Thanks, request received.');
});

test('success and confirm snippets do not start mid-word', async () => {
  const { snippet } = classifyPostSubmit('Request processed successfully. Your opt-out request has been received and is being handled.');
  assert.doesNotMatch(snippet, /^[a-z]/);
  const page = { evaluate: async () => PAGE };
  const confirm = await detectConfirmationRequired(page, 'en');
  assert.ok(confirm.pending);
  assert.match(confirm.snippet, /^(\.\.\. )?[A-Z]/);
});
