/**
 * test/secrets.test.js
 *
 * Security-sensitive unit tests for lib/secrets.js (pure crypto, no I/O):
 *   - round-trip fidelity (encrypt -> decrypt returns deep-equal object)
 *   - wrong passphrase is rejected (GCM auth tag mismatch -> throws)
 *   - tamper detection: flipping a byte of ciphertext / tag / iv throws
 *   - envelope shape detection (isEncryptedEnvelope)
 *   - input validation (empty passphrase, non-object plain, bad envelope)
 *
 * All values are hex strings so the envelope is JSON-serializable.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const secrets = require('../lib/secrets');
const { encryptConfig, decryptConfig, isEncryptedEnvelope } = secrets;

const PLAIN = {
  person: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  capsolver: { apiKey: 'CAP-SECRET-123' },
  email: { smtp: { host: 'smtp.example.com', port: 587, user: 'ada', pass: 'hunter2' } },
  profile: { label: 'main' },
};
const PASS = 'correct horse battery staple';

function flipHexByte(hex, index) {
  // Flip the low nibble of the byte at `index` so the value is guaranteed different.
  const pos = index * 2;
  const orig = hex.slice(pos, pos + 2);
  const flipped = (parseInt(orig, 16) ^ 0x01).toString(16).padStart(2, '0');
  return hex.slice(0, pos) + flipped + hex.slice(pos + 2);
}

test('round-trip: decryptConfig(encryptConfig(x)) deep-equals x', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  const out = secrets.decryptConfig(env, PASS);
  assert.deepEqual(out, PLAIN);
});

test('envelope has the documented v/salt/iv/tag/ciphertext fields as hex strings', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  assert.equal(env.v, 2);
  for (const k of ['salt', 'iv', 'tag', 'ciphertext']) {
    assert.equal(typeof env[k], 'string', `${k} should be a string`);
    assert.match(env[k], /^[0-9a-f]+$/, `${k} should be lowercase hex`);
  }
  assert.equal(env.alg, 'aes-256-gcm');
  assert.equal(env.kdf, 'scrypt');
});

test('two encryptions of the same input use different salt + iv (non-deterministic)', () => {
  const a = secrets.encryptConfig(PLAIN, PASS);
  const b = secrets.encryptConfig(PLAIN, PASS);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('wrong passphrase throws (auth tag mismatch)', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  assert.throws(() => secrets.decryptConfig(env, 'wrong passphrase'), /decrypt/i);
});

test('tamper: flipping a ciphertext byte throws', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  const tampered = { ...env, ciphertext: flipHexByte(env.ciphertext, 0) };
  assert.throws(() => secrets.decryptConfig(tampered, PASS), /decrypt/i);
});

test('tamper: flipping an auth-tag byte throws', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  const tampered = { ...env, tag: flipHexByte(env.tag, 0) };
  assert.throws(() => secrets.decryptConfig(tampered, PASS), /decrypt/i);
});

test('tamper: flipping an iv byte throws', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  const tampered = { ...env, iv: flipHexByte(env.iv, 0) };
  assert.throws(() => secrets.decryptConfig(tampered, PASS), /decrypt/i);
});

test('isEncryptedEnvelope: true for a real envelope, false for a plaintext config', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  assert.equal(secrets.isEncryptedEnvelope(env), true);
  assert.equal(secrets.isEncryptedEnvelope(PLAIN), false);
  assert.equal(secrets.isEncryptedEnvelope(null), false);
  assert.equal(secrets.isEncryptedEnvelope('string'), false);
  assert.equal(secrets.isEncryptedEnvelope({ v: 1 }), false);
});

test('encryptConfig rejects an empty passphrase', () => {
  assert.throws(() => secrets.encryptConfig(PLAIN, ''), /passphrase/i);
});

test('decryptConfig rejects an empty passphrase', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  assert.throws(() => secrets.decryptConfig(env, ''), /passphrase/i);
});

test('encryptConfig rejects a non-object plain value', () => {
  assert.throws(() => secrets.encryptConfig('not-an-object', PASS), /object/i);
  assert.throws(() => secrets.encryptConfig(null, PASS), /object/i);
});

test('decryptConfig rejects a value that is not an envelope', () => {
  assert.throws(() => secrets.decryptConfig({ foo: 'bar' }, PASS), /envelope/i);
});

test('decryptConfig rejects an unsupported envelope version', () => {
  const env = secrets.encryptConfig(PLAIN, PASS);
  assert.throws(() => secrets.decryptConfig({ ...env, v: 99 }, PASS), /version/i);
});

// Review 2026-10-15 (low): N=2^14 made offline guessing of a stolen
// config.json.enc cheap, and a shortened GCM tag was accepted.
test('new envelopes are v2 with the scrypt cost stored and at least 2^17', () => {
  const env = encryptConfig({ a: 1 }, 'pw');
  assert.equal(env.v, 2);
  assert.ok(env.kdfParams && env.kdfParams.N >= 131072, JSON.stringify(env.kdfParams));
  assert.deepEqual(decryptConfig(env, 'pw'), { a: 1 });
  assert.equal(isEncryptedEnvelope(env), true);
});

test('a v1 envelope made with the old cost still decrypts', () => {
  const crypto = require('node:crypto');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync('pw', salt, 32, { N: 16384, r: 8, p: 1 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ old: true })), c.final()]);
  const env = { v: 1, alg: 'aes-256-gcm', kdf: 'scrypt', salt: salt.toString('hex'), iv: iv.toString('hex'), tag: c.getAuthTag().toString('hex'), ciphertext: ct.toString('hex') };
  assert.equal(isEncryptedEnvelope(env), true);
  assert.deepEqual(decryptConfig(env, 'pw'), { old: true });
});

test('a shortened tag or a wrong-length IV is refused', () => {
  const env = encryptConfig({ a: 1 }, 'pw');
  assert.throws(() => decryptConfig({ ...env, tag: env.tag.slice(0, 8) }, 'pw'), /tag|envelope/);
  assert.throws(() => decryptConfig({ ...env, iv: env.iv + '00' }, 'pw'), /iv|envelope/i);
});

test('a v2 envelope with an out-of-range cost is refused before any work', () => {
  const env = encryptConfig({ a: 1 }, 'pw');
  assert.throws(() => decryptConfig({ ...env, kdfParams: { N: 2 ** 30, r: 8, p: 1 } }, 'pw'), /cost|kdf/i);
});
