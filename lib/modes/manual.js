'use strict';
/**
 * lib/modes/manual.js - --manual: print the sites waiting for the member to
 * finish by hand, with the reason and link each run gave, then exit.
 */

async function run() {
  const { loadState } = require('../config');
  const { manualEntries } = require('../manual');
  const entries = manualEntries(loadState());
  if (entries.length === 0) {
    console.log('\nNo sites are waiting for you to finish by hand.\n');
    return 0;
  }
  console.log('');
  for (const e of entries) {
    const who = e.person ? ` (${e.person})` : '';
    console.log(`${e.name}${who} - listed ${String(e.since).slice(0, 10)}`);
    console.log(`    ${e.detail || '(no link recorded)'}`);
  }
  console.log(`\n${entries.length} site(s) need you. When you finish one: upec-wipe done "<name>"\n`);
  return 0;
}

module.exports = { run };
