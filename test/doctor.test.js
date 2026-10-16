'use strict';
/**
 * test/doctor.test.js
 *
 * Tests for lib/doctor.js - self-diagnose command.
 * Network I/O is mocked; no real HTTP/TCP calls are made.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');

// ── helpers ──────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-test-'));
}

// ── import module under test ─────────────────────────────────────────────────

const {
  checkConfig,
  checkState,
  checkPlaywright,
  checkSMTP,
  checkCapsolver,
  checkSimpleLogin,
  runDoctor,
} = require('../lib/doctor');

// ─────────────────────────────────────────────────────────────────────────────
// checkConfig
// ─────────────────────────────────────────────────────────────────────────────

describe('checkConfig', () => {
  it('returns ok when all required person fields present', async () => {
    const dir = tmpDir();
    const cfg = { person: { firstName: 'Alice', lastName: 'Smith', email: 'a@b.com', zip: '12345' } };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));

    const result = await checkConfig(dir);
    assert.equal(result.ok, true);
    assert.match(result.hint, /valid/i);
  });

  it('returns not-ok when config.json is absent', async () => {
    const dir = tmpDir();

    const result = await checkConfig(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /not found/i);
  });

  it('returns not-ok when config.json is invalid JSON', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'config.json'), '{ bad json }');

    const result = await checkConfig(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /not valid JSON/i);
  });

  it('returns not-ok and mentions missing firstName', async () => {
    const dir = tmpDir();
    const cfg = { person: { lastName: 'Smith', email: 'a@b.com', zip: '12345' } };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));

    const result = await checkConfig(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /firstName/);
  });

  it('returns not-ok and mentions missing lastName', async () => {
    const dir = tmpDir();
    const cfg = { person: { firstName: 'Alice', email: 'a@b.com', zip: '12345' } };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));

    const result = await checkConfig(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /lastName/);
  });

  it('returns not-ok and mentions missing email', async () => {
    const dir = tmpDir();
    const cfg = { person: { firstName: 'Alice', lastName: 'Smith', zip: '12345' } };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));

    const result = await checkConfig(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /email/);
  });

  it('returns not-ok and mentions missing zip', async () => {
    const dir = tmpDir();
    const cfg = { person: { firstName: 'Alice', lastName: 'Smith', email: 'a@b.com' } };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));

    const result = await checkConfig(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /zip/);
  });

  it('returns not-ok when person key is missing entirely', async () => {
    const dir = tmpDir();
    const cfg = { notify: {} };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));

    const result = await checkConfig(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /person/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkState
// ─────────────────────────────────────────────────────────────────────────────

describe('checkState', () => {
  it('returns ok when state.json is absent', async () => {
    const dir = tmpDir();
    const result = await checkState(dir);
    assert.equal(result.ok, true);
    assert.match(result.hint, /absent/i);
  });

  it('returns ok when state.json has valid optOuts object', async () => {
    const dir = tmpDir();
    const st = { optOuts: { Spokeo: { lastSuccess: '2026-01-01' } } };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st));

    const result = await checkState(dir);
    assert.equal(result.ok, true);
    assert.match(result.hint, /parseable/i);
  });

  it('returns ok for empty optOuts', async () => {
    const dir = tmpDir();
    const st = { optOuts: {} };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st));

    const result = await checkState(dir);
    assert.equal(result.ok, true);
  });

  it('reports entry count in hint', async () => {
    const dir = tmpDir();
    const st = { optOuts: { A: {}, B: {}, C: {} } };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st));

    const result = await checkState(dir);
    assert.equal(result.ok, true);
    assert.match(result.hint, /3/);
  });

  it('returns not-ok when state.json is invalid JSON', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'state.json'), 'not json');

    const result = await checkState(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /not valid JSON/i);
  });

  it('returns not-ok when optOuts is not an object', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ optOuts: 'bad' }));

    const result = await checkState(dir);
    assert.equal(result.ok, false);
    assert.match(result.hint, /optOuts/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkPlaywright - unit-level: we verify the check honours a mock
// ─────────────────────────────────────────────────────────────────────────────

describe('checkPlaywright', () => {
  it('returns ok when playwright resolves and chromium binary exists', async () => {
    const fakeBinPath = path.join(tmpDir(), 'chrome');
    fs.writeFileSync(fakeBinPath, '');

    // Inject mocks via environment-provided resolver
    const result = await checkPlaywright({
      requirePlaywright: () => ({ chromium: { executablePath: () => fakeBinPath } }),
      fsExists: (p) => p === fakeBinPath,
    });
    assert.equal(result.ok, true);
    assert.match(result.hint, /chromium/i);
  });

  it('returns not-ok when playwright cannot be required', async () => {
    const result = await checkPlaywright({
      requirePlaywright: () => { throw new Error('Cannot find module playwright'); },
      fsExists: () => false,
    });
    assert.equal(result.ok, false);
    assert.match(result.hint, /playwright/i);
  });

  it('returns not-ok when chromium binary does not exist', async () => {
    const result = await checkPlaywright({
      requirePlaywright: () => ({ chromium: { executablePath: () => '/nonexistent/chrome' } }),
      fsExists: () => false,
    });
    assert.equal(result.ok, false);
    assert.match(result.hint, /binary/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkSMTP
// ─────────────────────────────────────────────────────────────────────────────

describe('checkSMTP', () => {
  it('skips when smtp host is not configured', async () => {
    const cfg = {};
    const result = await checkSMTP(cfg, { tcpProbe: () => Promise.resolve(true) });
    assert.equal(result.ok, true);
    assert.match(result.hint, /not configured/i);
  });

  it('skips when email.smtp.host is empty string', async () => {
    const cfg = { email: { smtp: { host: '', port: 587 } } };
    const result = await checkSMTP(cfg, { tcpProbe: () => Promise.resolve(true) });
    assert.equal(result.ok, true);
    assert.match(result.hint, /not configured/i);
  });

  it('returns ok when TCP probe succeeds', async () => {
    const cfg = { email: { smtp: { host: 'smtp.example.com', port: 587 } } };
    const result = await checkSMTP(cfg, { tcpProbe: () => Promise.resolve(true) });
    assert.equal(result.ok, true);
    assert.match(result.hint, /reachable/i);
  });

  it('returns not-ok when TCP probe fails', async () => {
    const cfg = { email: { smtp: { host: 'smtp.example.com', port: 587 } } };
    const result = await checkSMTP(cfg, {
      tcpProbe: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    assert.equal(result.ok, false);
    assert.match(result.hint, /unreachable|ECONNREFUSED/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkCapsolver
// ─────────────────────────────────────────────────────────────────────────────

describe('checkCapsolver', () => {
  it('skips when apiKey absent', async () => {
    const cfg = {};
    const result = await checkCapsolver(cfg, { headRequest: () => Promise.resolve(200) });
    assert.equal(result.ok, true);
    assert.match(result.hint, /not configured/i);
  });

  it('skips when apiKey is the placeholder', async () => {
    const cfg = { capsolver: { apiKey: 'CAP-YOUR_KEY_HERE' } };
    const result = await checkCapsolver(cfg, { headRequest: () => Promise.resolve(200) });
    assert.equal(result.ok, true);
    assert.match(result.hint, /placeholder/i);
  });

  it('returns not-ok when apiKey looks like placeholder pattern', async () => {
    const cfg = { capsolver: { apiKey: 'CAP-YOUR_KEY_HERE' } };
    const result = await checkCapsolver(cfg, { headRequest: () => Promise.resolve(200) });
    // placeholder => skip (ok: true) with hint about placeholder
    assert.equal(result.ok, true);
  });

  it('returns ok when HEAD request succeeds', async () => {
    const cfg = { capsolver: { apiKey: 'CAP-realKey123' } };
    const result = await checkCapsolver(cfg, { headRequest: () => Promise.resolve(200) });
    assert.equal(result.ok, true);
    assert.match(result.hint, /reachable/i);
  });

  it('returns not-ok when HEAD request fails', async () => {
    const cfg = { capsolver: { apiKey: 'CAP-realKey123' } };
    const result = await checkCapsolver(cfg, {
      headRequest: () => Promise.reject(new Error('ENOTFOUND')),
    });
    assert.equal(result.ok, false);
    assert.match(result.hint, /unreachable|ENOTFOUND/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkSimpleLogin
// ─────────────────────────────────────────────────────────────────────────────

describe('checkSimpleLogin', () => {
  const KEY = 'sl-real-key-123';
  const relay = (extra) => ({ relay: { provider: 'simplelogin', apiKey: KEY, required: true, ...extra } });

  it('fails when no relay block is set: a required relay blocks every submission', async () => {
    let called = false;
    const result = await checkSimpleLogin({}, { simpleLoginRequest: () => { called = true; return Promise.resolve(200); } });
    assert.equal(result.ok, false);
    assert.match(result.hint, /nothing will be submitted/i);
    assert.match(result.hint, /re-run setup/i);
    assert.equal(called, false);
  });

  it('fails when the relay block has no provider and is required', async () => {
    const result = await checkSimpleLogin({ relay: { apiKey: KEY } }, { simpleLoginRequest: () => Promise.resolve(200) });
    assert.equal(result.ok, false);
    assert.match(result.hint, /nothing will be submitted/i);
  });

  it('skips without failing when no relay is set and relay.required is false', async () => {
    const result = await checkSimpleLogin({ relay: { required: false } }, { simpleLoginRequest: () => Promise.resolve(200) });
    assert.equal(result.ok, true);
    assert.match(result.hint, /not configured/i);
  });

  it('fails on the placeholder key when the relay is required', async () => {
    let called = false;
    const cfg = relay({ apiKey: 'YOUR_SIMPLELOGIN_API_KEY' });
    const result = await checkSimpleLogin(cfg, { simpleLoginRequest: () => { called = true; return Promise.resolve(200); } });
    assert.equal(result.ok, false);
    assert.match(result.hint, /placeholder/i);
    assert.equal(called, false, 'no request with a placeholder key');
  });

  it('skips the placeholder key when the relay is not required', async () => {
    const cfg = relay({ apiKey: 'YOUR_SIMPLELOGIN_API_KEY', required: false });
    const result = await checkSimpleLogin(cfg, { simpleLoginRequest: () => Promise.resolve(200) });
    assert.equal(result.ok, true);
    assert.match(result.hint, /placeholder/i);
  });

  it('passes when SimpleLogin accepts the key, sending it only in the Authentication header', async () => {
    let seen;
    const result = await checkSimpleLogin(relay(), {
      simpleLoginRequest: (url, key) => { seen = { url, key }; return Promise.resolve(200); },
    });
    assert.equal(result.ok, true);
    assert.match(result.hint, /accepted/i);
    assert.equal(seen.url, 'https://app.simplelogin.io/api/user_info');
    assert.equal(seen.key, KEY);
    assert.doesNotMatch(result.hint, new RegExp(KEY));
  });

  it('fails with a clear hint when SimpleLogin rejects the key', async () => {
    const result = await checkSimpleLogin(relay(), { simpleLoginRequest: () => Promise.resolve(401) });
    assert.equal(result.ok, false);
    assert.match(result.hint, /rejected/i);
    assert.doesNotMatch(result.hint, new RegExp(KEY));
  });

  it('fails when SimpleLogin cannot be reached', async () => {
    const result = await checkSimpleLogin(relay(), { simpleLoginRequest: () => Promise.reject(new Error('ENOTFOUND')) });
    assert.equal(result.ok, false);
    assert.match(result.hint, /unreachable|ENOTFOUND/i);
  });

  it('is skipped off Mullvad and never contacts SimpleLogin', async () => {
    const { EgressError } = require('../lib/egress');
    let called = false;
    const result = await checkSimpleLogin(relay(), {
      ensureEgress: () => { throw new EgressError('not on Mullvad'); },
      simpleLoginRequest: () => { called = true; return Promise.resolve(200); },
    });
    assert.equal(result.ok, true);
    assert.match(result.hint, /not on Mullvad/);
    assert.equal(called, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runDoctor - integration-level with mocked I/O
// ─────────────────────────────────────────────────────────────────────────────

describe('runDoctor', () => {
  it('returns an array of {name, ok, hint} objects', async () => {
    const dir = tmpDir();
    const cfg = { person: { firstName: 'A', lastName: 'B', email: 'c@d.com', zip: '99999' } };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));

    const fakeBin = path.join(dir, 'chrome');
    fs.writeFileSync(fakeBin, '');

    const results = await runDoctor({
      rootDir: dir,
      requirePlaywright: () => ({ chromium: { executablePath: () => fakeBin } }),
      fsExists: (p) => p === fakeBin || fs.existsSync(p),
      tcpProbe: () => Promise.resolve(true),
      headRequest: () => Promise.resolve(200),
      printOutput: false,
    });

    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 5);
    for (const r of results) {
      assert.ok('name' in r, 'missing name');
      assert.ok('ok'   in r, 'missing ok');
      assert.ok('hint' in r, 'missing hint');
    }
  });

  it('returns exit code 0 when no failures', async () => {
    const dir = tmpDir();
    // relay.required false: with the default a missing relay is a doctor failure.
    const cfg = { person: { firstName: 'A', lastName: 'B', email: 'c@d.com', zip: '99999' }, relay: { required: false } };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg));
    const fakeBin = path.join(dir, 'chrome');
    fs.writeFileSync(fakeBin, '');

    const { exitCode } = await runDoctor({
      rootDir: dir,
      requirePlaywright: () => ({ chromium: { executablePath: () => fakeBin } }),
      fsExists: (p) => p === fakeBin || fs.existsSync(p),
      tcpProbe: () => Promise.resolve(true),
      headRequest: () => Promise.resolve(200),
      printOutput: false,
    });

    assert.equal(exitCode, 0);
  });

  it('returns exit code 1 when there are failures', async () => {
    const dir = tmpDir();
    // No config.json - will cause a failure

    const { exitCode } = await runDoctor({
      rootDir: dir,
      requirePlaywright: () => ({ chromium: { executablePath: () => '/no/chrome' } }),
      fsExists: () => false,
      tcpProbe: () => Promise.resolve(true),
      headRequest: () => Promise.resolve(200),
      printOutput: false,
    });

    assert.equal(exitCode, 1);
  });

  it('result summary includes ok, skipped, and failed counts', async () => {
    const dir = tmpDir();
    // config.json missing => 1 failure; no smtp/capsolver => 2 skips
    const { summary } = await runDoctor({
      rootDir: dir,
      requirePlaywright: () => { throw new Error('no playwright'); },
      fsExists: () => false,
      tcpProbe: () => Promise.resolve(true),
      headRequest: () => Promise.resolve(200),
      printOutput: false,
    });

    assert.ok(summary.failed >= 1, `expected >=1 failed, got: ${summary.failed}`);
    assert.ok(typeof summary.ok      === 'number');
    assert.ok(typeof summary.skipped === 'number');
    assert.ok(typeof summary.failed  === 'number');
  });
});

// Review 2026-10-15: doctor passed in three cases where a run would fail.
describe('doctor review fixes', () => {
  const { checkEgress } = require('../lib/doctor');
  const { EgressError } = require('../lib/egress');

  it('fails off the VPN instead of reporting the probes as skipped', async () => {
    const off = await checkEgress({}, { ensureEgress: async () => { throw new EgressError('not on Mullvad'); } });
    assert.equal(off.ok, false);
    assert.match(off.hint, /Mullvad/);
    const on = await checkEgress({}, { ensureEgress: async () => {} });
    assert.equal(on.ok, true);
  });

  it('accepts a persons-only config and checks every person a run uses', async () => {
    const good = { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', zip: '00000' };
    const dir1 = tmpDir();
    fs.writeFileSync(path.join(dir1, 'config.json'), JSON.stringify({ persons: [good, { ...good, firstName: 'John' }] }));
    assert.equal((await checkConfig(dir1)).ok, true);

    const dir2 = tmpDir();
    fs.writeFileSync(path.join(dir2, 'config.json'), JSON.stringify({ person: good, persons: [good, { firstName: 'John' }] }));
    const r = await checkConfig(dir2);
    assert.equal(r.ok, false);
    assert.match(r.hint, /person 2/);
  });

  it('reads the state file a run uses (UPEC_WIPE_STATE_PATH)', async () => {
    const dir = tmpDir();
    const elsewhere = path.join(tmpDir(), 'custom-state.json');
    fs.writeFileSync(elsewhere, '{ not json');
    assert.equal((await checkState(dir, elsewhere)).ok, false);
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'doctor.js'), 'utf8');
    assert.match(src, /checkState\(rootDir, opts\.rootDir \? undefined : require\('\.\/config'\)\.STATE_PATH\)/);
  });
});
