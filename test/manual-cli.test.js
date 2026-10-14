'use strict';
/**
 * test/manual-cli.test.js
 *
 * `upec-wipe manual` lists the sites waiting for the member with their links;
 * `upec-wipe done <broker>` marks one finished (clearing manual and pending
 * entries and starting the re-check window). Spawned in the config-free
 * fixture copy, with a state.json written there.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeFixtureRepo, runIn: runInRepo } = require('./helpers/fixture-repo');

const dir = makeFixtureRepo();
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const statePath = path.join(dir, 'state.json');
const runIn = (d, script, opts, args) => runInRepo(d, script, args, opts);

function withState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state));
}
const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));

const STATE = { optOuts: {
  WhitePages: { manual: { since: '2026-10-14T21:17:12.000Z', detail: 'blocked by bot protection - open in your normal browser: https://www.whitepages.com/suppression-requests' } },
  'Acme People': { manual: { since: '2026-10-14T21:20:00.000Z', detail: 'Search and pick your record: https://acme.example/optout' } },
  PeopleFinders: { pendingConfirm: { since: '2026-10-14T21:18:51.000Z', snippet: 'check your inbox' }, lastAttempt: '2026-10-14T21:18:51.000Z' },
} };

test('manual lists every open site with its reason and link, and loads no browser', () => {
  withState(STATE);
  const r = runIn(dir, 'watcher.js', { statePath }, ['--manual']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /BROWSER_MODULE_LOADED/);
  assert.match(r.stdout, /WhitePages/);
  assert.match(r.stdout, /https:\/\/www\.whitepages\.com\/suppression-requests/);
  assert.match(r.stdout, /Acme People/);
  assert.match(r.stdout, /2 site\(s\) need you/);
  assert.match(r.stdout, /upec-wipe done/);
  assert.doesNotMatch(r.stdout, /PeopleFinders/, 'email-confirmation brokers belong to `pending`');
});

test('manual with nothing open says so', () => {
  withState({ optOuts: {} });
  const r = runIn(dir, 'watcher.js', { statePath }, ['--manual']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No sites are waiting for you/);
});

test('done clears a manual entry and starts the re-check window', () => {
  withState(STATE);
  const r = runIn(dir, 'watcher.js', { statePath }, ['--done', 'whitepages']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WhitePages: marked done/);
  const e = readState().optOuts.WhitePages;
  assert.equal(e.manual, undefined);
  assert.equal(typeof e.lastSuccess, 'string');
  assert.match(e.lastDetail, /done by hand/);
});

test('done clears a pending email confirmation too', () => {
  withState(STATE);
  const r = runIn(dir, 'watcher.js', { statePath }, ['--done', 'PeopleFinders']);
  assert.equal(r.status, 0, r.stderr);
  const e = readState().optOuts.PeopleFinders;
  assert.equal(e.pendingConfirm, undefined);
  assert.equal(typeof e.lastSuccess, 'string');
});

test('done refuses an unknown name and a missing name, changing nothing', () => {
  withState(STATE);
  let r = runIn(dir, 'watcher.js', { statePath }, ['--done', 'Nobody Such']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No broker or site matches "Nobody Such"/);
  r = runIn(dir, 'watcher.js', { statePath }, ['--done']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage: upec-wipe done <broker>/);
  assert.deepEqual(readState(), STATE);
});

test('manual --import-last-run fills the list from the newest run log, once', () => {
  withState({ optOuts: { USPhonebook: { lastSuccess: new Date().toISOString() } } });
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'run-2026-10-14T21-16-42.json'), JSON.stringify({
    runAt: '2026-10-14T21:16:42.000Z',
    manual: [
      { broker: 'WhitePages', status: 'manual', detail: 'blocked by bot protection - open in your normal browser: https://www.whitepages.com/suppression-requests' },
      { broker: 'USPhonebook', status: 'manual', detail: 'https://www.usphonebook.com/removal' },
    ],
    captchaFailed: [{ broker: 'FamilyTreeNow', status: 'captcha_failed', detail: 'https://www.familytreenow.com/optout' }],
  }));
  let r = runIn(dir, 'watcher.js', { statePath }, ['--manual', '--import-last-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Imported 2 site\(s\)/);
  assert.match(r.stdout, /WhitePages/);
  assert.match(r.stdout, /FamilyTreeNow/);
  const st = readState().optOuts;
  assert.equal(st.WhitePages.manual.since, '2026-10-14T21:16:42.000Z');
  assert.equal(st.USPhonebook.manual, undefined, 'a site already done is not imported');
  r = runIn(dir, 'watcher.js', { statePath }, ['--manual', '--import-last-run']);
  assert.match(r.stdout, /Imported 0 site\(s\)/);
  fs.rmSync(logs, { recursive: true, force: true });
});

test('done takes several names, and changes nothing when one is unknown', () => {
  withState(STATE);
  let r = runIn(dir, 'watcher.js', { statePath }, ['--done', 'Nobody Such', 'WhitePages']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No broker or site matches "Nobody Such"/);
  assert.deepEqual(readState(), STATE);
  r = runIn(dir, 'watcher.js', { statePath }, ['--done', 'WhitePages', 'acme people']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /WhitePages: marked done/);
  assert.match(r.stdout, /Acme People: marked done/);
  const st = readState().optOuts;
  assert.equal(st.WhitePages.manual, undefined);
  assert.equal(st['Acme People'].manual, undefined);
});

test('manual --import-last-run refuses with several people instead of guessing', () => {
  withState({ optOuts: { 'Spokeo|Jane Doe': {}, 'Spokeo|John Doe': {} } });
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'run-2026-10-14T21-16-42.json'), JSON.stringify({ runAt: 'x', manual: [{ broker: 'WhitePages', detail: 'https://w.example' }] }));
  const r = runIn(dir, 'watcher.js', { statePath }, ['--manual', '--import-last-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /one person only/);
  assert.equal(readState().optOuts.WhitePages, undefined);
  fs.rmSync(logs, { recursive: true, force: true });
});
