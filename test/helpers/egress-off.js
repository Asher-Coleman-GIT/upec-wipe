/**
 * test/helpers/egress-off.js
 *
 * Test preload (node --require). The Node-side egress gate (lib/egress.js,
 * audit M7) has no env-var bypass, so tests keep it off the network here:
 * global fetch answers the Mullvad check URL with an on-VPN reply and passes
 * every other URL through untouched. Tests that exercise the gate itself
 * inject their own fetchJson.
 *
 * NODE_OPTIONS carries the preload into child processes, including ones that
 * run from a temp copy of the repo (they load their own lib/egress.js but
 * share this patched fetch).
 */
'use strict';

const path = require('node:path');

// Keep test runs off the repo's state.json as well.
require('./test-state');

const MULLVAD_CHECK_URL = 'https://am.i.mullvad.net/json';

const realFetch = globalThis.fetch;
globalThis.fetch = async function egressOffFetch(input, init) {
  const url = typeof input === 'string' ? input : (input && (input.url || input.href));
  if (url === MULLVAD_CHECK_URL) {
    return new Response(JSON.stringify({ mullvad_exit_ip: true, country: 'Test' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(input, init);
};

const self = `--require ${JSON.stringify(path.resolve(__filename))}`;
if (!(process.env.NODE_OPTIONS || '').includes(self)) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} ${self}`.trim();
}
