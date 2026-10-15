'use strict';
/**
 * test/reply-classify.test.js
 *
 * lib/reply-classify.js suggests an outcome for a broker's reply to an email
 * request, with the sentence it based that on. Texts are paraphrases of the
 * reply types seen on 2026-10-15; the member confirms every outcome.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyReply, stripQuoted, combineOutcomes } = require('../lib/reply-classify');

const c = (text, extra = {}) => classifyReply({ text, subject: extra.subject || 'Re: Privacy request', fromAddress: extra.from || 'privacy@broker.example' });

test('honored: completed, processed, no data held, suppressed', () => {
  for (const t of [
    'We are writing to confirm that your right to erasure request has been completed.',
    'We have processed your request and confirmed that we do not hold any personal data associated with this individual.',
    'We did not find any profiles in our system that match the data points provided.',
    'The information provided has been added to our suppression lists. We have marked this request as completed.',
    'The company has ceased operating as a data broker and no longer possesses personal information.',
    'All personal data associated with your account has either not been found in our database, or has been permanently removed.',
  ]) assert.equal(c(t).outcome, 'honored', t);
});

test('refused: email not accepted, use the form or portal', () => {
  for (const t of [
    'While we are unable to accept opt out or other privacy requests via email, you may use the online form.',
    'YOUR EMAIL HAS NOT BEEN PROCESSED. To request removal please use our secure dedicated privacy portal.',
    'Privacy requests cannot be processed by email. All consumer requests must be submitted through our online form.',
    'Please submit your request through one of the designated methods identified in our privacy policy.',
    'You can visit our Privacy Choices portal, where you can exercise your rights.',
    'If you would like to submit a request, please visit our site and fill out the appropriate webform.',
    'The fastest and simplest way is to use our self-service tool. You will get an email requiring you to confirm your request.',
    'Emails sent to this address for any other purpose will not be processed.',
  ]) assert.equal(c(t).outcome, 'refused', t);
});

test('verify: confirm you own the mailbox', () => {
  const r = c('We need to confirm that you are the owner/controller of this email address. Please confirm by clicking the link below or responding to this email.');
  assert.equal(r.outcome, 'verify');
  assert.match(r.evidence, /owner\/controller|confirm by clicking/);
});

test('bounced: delivery failures', () => {
  assert.equal(c('Your email could not be delivered.', { subject: 'Undeliverable: Privacy request', from: 'postmaster@broker.example' }).outcome, 'bounced');
  assert.equal(c('Delivery has failed to these recipients', { subject: 'Delivery Status Notification (Failure)', from: 'mailer-daemon@googlemail.com' }).outcome, 'bounced');
});

test('pending: received, will review or process', () => {
  for (const t of [
    'We have received your request and will process it within the time period required by applicable law.',
    "Thanks for reaching out! We'll review your request and follow-up if necessary.",
    'This email is a formal receipt and acknowledgment of your request. You will receive confirmation when your request is complete.',
  ]) assert.equal(c(t).outcome, 'pending', t);
  assert.equal(c('A request (12345) has been created regarding your message.').outcome, 'pending');
});

test('our own letter quoted below a reply never decides the outcome', () => {
  const quoted = 'Thanks.\n\nOn Thu, Oct 15, 2026 at 10:00 AM <me@example.com> wrote:\n> To the privacy team,\n> Please confirm when this is done by replying to me@example.com.';
  assert.equal(stripQuoted(quoted).trim(), 'Thanks.');
  assert.equal(c(quoted).outcome, 'unknown');
  assert.equal(stripQuoted('Done.\n-----Original Message-----\nFrom: me\nPlease confirm').trim(), 'Done.');
  assert.equal(stripQuoted('Done.\n\nTo the privacy team,\n\nI am a Utah resident.').trim(), 'Done.');
});

test('"has not been processed" is not "has been processed"; "will be complete" is not completed', () => {
  assert.notEqual(c('Your email has not been processed.').outcome, 'honored');
  assert.notEqual(c('You will receive confirmation when your request is complete.').outcome, 'honored');
});

test('several replies from one broker: the most useful outcome wins', () => {
  assert.equal(combineOutcomes(['pending', 'refused']), 'refused');
  assert.equal(combineOutcomes(['pending', 'honored', 'refused']), 'honored');
  assert.equal(combineOutcomes(['unknown', 'verify']), 'verify');
  assert.equal(combineOutcomes(['unknown']), 'unknown');
});

// 2026-10-15 live run.
test('line breaks and non-breaking spaces inside a phrase still match', () => {
  assert.equal(c('You can visit our Privacy Choices\nportal (https://app.broker.example/your-privacy-choices), where you can exercise your rights.').outcome, 'refused');
  assert.equal(c('You can visit our Privacy Choices portal.').outcome, 'refused');
});

test('the quoted sentence is not cut at the dot inside a link', () => {
  const r = c('Requests must be submitted by completing a Privacy Request Form at catalist.us/your-privacy-choices. Thanks.');
  assert.equal(r.evidence, 'Requests must be submitted by completing a Privacy Request Form at catalist.us/your-privacy-choices.');
});

test('a link quoted in the evidence loses its query string', () => {
  const r = c('Please use our form at https://broker.example/optout?token=abc123&id=9 to continue.');
  assert.doesNotMatch(r.evidence, /token|abc123/);
  assert.match(r.evidence, /https:\/\/broker\.example\/optout/);
});

// 2026-10-15 live run: a help desk put a dashed divider above its answer.
test('a divider before any text is not where the quote starts', () => {
  const r = c('----------------------------------------------\nJane, thank you for your email. To submit a data deletion and opt-out request, please complete the form located at the link below.\n\nOn Thu, Oct 15, 2026 someone wrote:\n> To the privacy team,');
  assert.equal(r.outcome, 'refused');
});
