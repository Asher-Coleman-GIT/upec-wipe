'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('update-catalog-sources runs the feeds refresh behind the egress config', async () => {
  const { main } = require('../scripts/update-catalog-sources');
  const calls = [];
  const code = await main({
    loadConfig: () => ({ network: { required: true } }),
    configExists: () => true,
    setEgressConfig: (c) => calls.push(['egress', c]),
    runUpdateBrokers: async (o) => { calls.push(['update', Array.isArray(o.brokers), typeof o.logFn]); },
    log: () => {}, warn: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(calls[0], ['egress', { network: { required: true } }]);
  assert.deepEqual(calls[1], ['update', true, 'function']);
});

test('an unreadable config falls back to the Mullvad-required defaults, with a warning', async () => {
  const { main } = require('../scripts/update-catalog-sources');
  const warned = [];
  let egress;
  const code = await main({
    loadConfig: () => { throw Object.assign(new Error('x'), { code: 'EBADCFG' }); },
    configExists: () => true,
    setEgressConfig: (c) => { egress = c; },
    runUpdateBrokers: async () => {},
    log: () => {}, warn: (m) => warned.push(m),
  });
  assert.equal(code, 0);
  assert.deepEqual(egress, {});
  assert.match(warned[0], /using network defaults \(Mullvad check required\)/);
});

test('a failed refresh exits 1', async () => {
  const { main } = require('../scripts/update-catalog-sources');
  const code = await main({
    loadConfig: () => ({}), configExists: () => false, setEgressConfig: () => {},
    runUpdateBrokers: async () => { throw new Error('boom'); }, log: () => {}, warn: () => {},
  });
  assert.equal(code, 1);
});

test('the update-brokers mode is gone', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'lib', 'modes', 'update-brokers.js')), false);
});

test('the fallback warning never echoes config contents from a JSON parse error', async () => {
  const { main } = require('../scripts/update-catalog-sources');
  const warned = [];
  await main({
    loadConfig: () => { throw new SyntaxError('Unexpected token J in JSON at position 3: {"person":{"firstName":"Jane"'); },
    configExists: () => true, setEgressConfig: () => {}, runUpdateBrokers: async () => {},
    log: () => {}, warn: (m) => warned.push(m),
  });
  assert.equal(warned.length, 1);
  assert.doesNotMatch(warned[0], /Jane|person/);
  assert.match(warned[0], /config\.json is not valid JSON/);
});
