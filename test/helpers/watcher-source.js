'use strict';
// watcher.js and its mode files, for tests that pin wiring by source text.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const MODES = path.join(ROOT, 'lib', 'modes');

function modeFiles() {
  return fs.readdirSync(MODES).filter(f => f.endsWith('.js')).sort().map(f => path.join('lib', 'modes', f));
}
function modeSource(name) {
  return fs.readFileSync(path.join(MODES, `${name}.js`), 'utf8');
}
function watcherSource() {
  return ['watcher.js', ...modeFiles()].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
}

module.exports = { watcherSource, modeSource, modeFiles };
