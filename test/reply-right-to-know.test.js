'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WATCHER = path.join(__dirname, '..', 'watcher.js');

function runReply(args, initialState) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-reply-'));
  const statePath = path.join(dir, 'state.json');
  fs.writeFileSync(statePath, JSON.stringify(initialState));
  const r = spawnSync(process.execPath, [WATCHER, '--reply', ...args], {
    env: { ...process.env, UPEC_WIPE_STATE_PATH: statePath }, encoding: 'utf8', timeout: 60000,
  });
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return { r, state };
}

test('reply --right-to-know logs against the know: key', () => {
  const { r, state } = runReply(['Pipl', 'bounced', '--right-to-know'], {
    optOuts: {}, emailSent: { 'know:Pipl': { to: 'privacy@pipl.com', at: 't', messageId: 'm' } },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(state.emailReplies['know:Pipl'].outcome, 'bounced');
  assert.equal(state.emailReplies.Pipl, undefined);
});

test('reply without the flag still logs against the deletion email key', () => {
  const { r, state } = runReply(['Pipl', 'honored'], {
    optOuts: {}, emailSent: { Pipl: { to: 'privacy@pipl.com', at: 't', messageId: 'm' } },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(state.emailReplies.Pipl.outcome, 'honored');
});

test('reply --right-to-know works wherever the flag sits', () => {
  const { r, state } = runReply(['--right-to-know', 'Pipl', 'bounced'], {
    optOuts: {}, emailSent: { 'know:Pipl': { to: 'privacy@pipl.com', at: 't', messageId: 'm' } },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(state.emailReplies['know:Pipl'].outcome, 'bounced');
});

test('reply skips the values of other flags such as --only', () => {
  const { r, state } = runReply(['--only', 'Acme', 'Pipl', 'honored'], {
    optOuts: {}, emailSent: { Pipl: { to: 'privacy@pipl.com', at: 't', messageId: 'm' } },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(state.emailReplies.Pipl.outcome, 'honored');
});
