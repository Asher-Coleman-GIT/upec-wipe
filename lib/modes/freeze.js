'use strict';
/**
 * lib/modes/freeze.js - --freeze / --freeze-done <key> / --freeze-clear <key> (moved from watcher.js).
 */
const { STATE_PATH, loadState } = require('../config');
const lock = require('../lock');
const { acquireStateLockOrExit } = require('./shared');

// ── --freeze / --freeze-done <key> / --freeze-clear <key> ─────────────────────
// Guided credit/identity freeze checklist. Pure guidance + tracking; no browser
// is launched. Subcommands persist state.freezes under the same state lock as a
// normal run so a concurrent run cannot race the write.
async function run({ flags }) {
  const { FREEZE_DONE_KEY, FREEZE_CLEAR_KEY } = flags;
  const { FREEZE_TARGETS, getFreezeStatus, recordFreezeDone, recordFreezeCleared, TARGET_KEYS } = require('../freeze');
  const state = loadState();

  // Mutating subcommands take the lock; the read-only list does not need it.
  const isMutation = FREEZE_DONE_KEY !== null || FREEZE_CLEAR_KEY !== null;
  const FREEZE_LOCK_PATH = STATE_PATH + '.lock';
  if (isMutation) {
    acquireStateLockOrExit();
  }

  try {
    if (FREEZE_DONE_KEY !== null) {
      if (!TARGET_KEYS.has(FREEZE_DONE_KEY)) {
        console.error(`unknown freeze target: "${FREEZE_DONE_KEY}". Valid keys: ${[...TARGET_KEYS].join(', ')}`);
        process.exit(1);
      }
      recordFreezeDone(state, FREEZE_DONE_KEY);
      console.log(`Marked freeze done: ${FREEZE_DONE_KEY}`);
    } else if (FREEZE_CLEAR_KEY !== null) {
      if (!TARGET_KEYS.has(FREEZE_CLEAR_KEY)) {
        console.error(`unknown freeze target: "${FREEZE_CLEAR_KEY}". Valid keys: ${[...TARGET_KEYS].join(', ')}`);
        process.exit(1);
      }
      recordFreezeCleared(state, FREEZE_CLEAR_KEY);
      console.log(`Cleared freeze: ${FREEZE_CLEAR_KEY}`);
    }
  } finally {
    if (isMutation) lock.release(FREEZE_LOCK_PATH);
  }

  // Always print the checklist after a list request or a mutation.
  const rows = getFreezeStatus(state);
  const doneCount = rows.filter(r => r.done).length;
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n Credit / identity freeze checklist');
  console.log('   Freezing your credit is the single highest-impact privacy action.');
  console.log('   Each target needs identity verification, so this is guidance, not automation.\n');
  console.log('   ' + pad('Done', 6) + pad('Target', 18) + pad('Type', 16) + 'URL');
  console.log('   ' + '-'.repeat(86));
  for (const r of rows) {
    const mark = r.done ? '[x]' : '[ ]';
    console.log('   ' + pad(mark, 6) + pad(r.name, 18) + pad(r.type, 16) + r.url);
  }
  console.log(`\n   ${doneCount}/${rows.length} complete.`);
  console.log('   Mark one done:  node watcher.js --freeze-done <key>');
  console.log('   Undo a mark:    node watcher.js --freeze-clear <key>');
  console.log(`   Keys: ${FREEZE_TARGETS.map(t => t.key).join(', ')}\n`);
  process.exit(0);
}

module.exports = { run };
