'use strict';
// A temp copy of the repo with no config.json or state.json, for tests that
// spawn watcher.js or bin/upec-wipe.js. Code is copied (not symlinked): Node
// resolves a symlinked lib/ to the real tree, whose config.json is real.
// data/ is copied too, so a run that writes data files (the registry refresh,
// search history) writes the copy. Only node_modules is symlinked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const COPY = ['watcher.js', 'brokers.js', 'setup.js', 'package.json', 'config.example.json', 'lib', 'bin', 'scripts', 'data'];

function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-fixture-'));
  for (const f of COPY) {
    const src = path.join(ROOT, f);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, f), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  for (const f of ['config.json', 'config.json.enc', 'state.json']) {
    if (fs.existsSync(path.join(dir, f))) throw new Error(`fixture must not hold ${f}`);
  }
  return dir;
}

// Spawn relScript inside dir with a preload that reports any playwright load.
function runIn(dir, relScript, args, opts = {}) {
  const preload = path.join(dir, '.trap.js');
  if (!fs.existsSync(preload)) {
    fs.writeFileSync(preload, [
      "'use strict';",
      "const Module = require('module');",
      'const orig = Module._load;',
      'Module._load = function (req, ...rest) {',
      "  if (/^playwright(-core)?(\\/|$)/.test(String(req))) process.stderr.write('BROWSER_MODULE_LOADED\\n');",
      '  return orig.call(this, req, ...rest);',
      '};',
    ].join('\n'));
  }
  const env = { ...process.env, NODE_ENV: 'test', HOME: dir, USERPROFILE: dir };
  delete env.UPEC_WIPE_STATE_PATH;
  delete env.UPEC_WIPE_PASSPHRASE;
  delete env.UPEC_WIPE_PASSPHRASE_FILE;
  return spawnSync(process.execPath, ['-r', preload, path.join(dir, relScript), ...args], {
    cwd: opts.cwd || dir, encoding: 'utf8', timeout: 30000, env,
  });
}

module.exports = { makeFixtureRepo, runIn, ROOT };
