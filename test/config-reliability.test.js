/**
 * test/config-reliability.test.js
 *
 * Fix 1 [crash-safety]: module-level state init is safe when state.json is corrupt.
 * Fix 2 [durability]: .bak is written atomically (tmp+rename) and is valid after save.
 *
 * All tests use temp paths only - never the real state.json.
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('node:fs');
const os       = require('node:os');
const path     = require('node:path');

const cfg = require('../lib/config');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-reliability-'));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ── Fix 1: readStateFileSafe is exported and works as a standalone helper ─────

test('readStateFileSafe: reads a valid JSON file correctly', () => {
  const dir  = makeTmpDir();
  const file = path.join(dir, 'state.json');
  try {
    const data = { optOuts: { broker1: { lastSuccess: '2025-01-01T00:00:00.000Z' } } };
    fs.writeFileSync(file, JSON.stringify(data));
    const result = cfg.readStateFileSafe(file);
    assert.deepEqual(result, data);
  } finally {
    cleanup(dir);
  }
});

test('readStateFileSafe: returns null for a corrupt (non-JSON) file', () => {
  const dir  = makeTmpDir();
  const file = path.join(dir, 'state.json');
  try {
    fs.writeFileSync(file, 'NOT JSON {{{');
    const result = cfg.readStateFileSafe(file);
    assert.equal(result, null);
  } finally {
    cleanup(dir);
  }
});

test('readStateFileSafe: returns null for a missing file', () => {
  const dir  = makeTmpDir();
  const file = path.join(dir, 'missing.json');
  try {
    const result = cfg.readStateFileSafe(file);
    assert.equal(result, null);
  } finally {
    cleanup(dir);
  }
});

test('readStateFileSafe: returns null for an empty file', () => {
  const dir  = makeTmpDir();
  const file = path.join(dir, 'state.json');
  try {
    fs.writeFileSync(file, '');
    const result = cfg.readStateFileSafe(file);
    assert.equal(result, null);
  } finally {
    cleanup(dir);
  }
});

// ── Fix 1: resetState falls back to .bak when primary is corrupt ──────────────

test('resetState: corrupt primary -> loads from .bak, no throw', () => {
  const dir       = makeTmpDir();
  const statePath = path.join(dir, 'state.json');
  const bakPath   = statePath + '.bak';
  try {
    // Corrupt primary, valid .bak
    fs.writeFileSync(statePath, 'CORRUPT {{{');
    const bakData = { optOuts: { fromBak: { lastSuccess: '2025-06-01T00:00:00.000Z' } } };
    fs.writeFileSync(bakPath, JSON.stringify(bakData));

    cfg.setTestStatePath(statePath);
    cfg.setDryRun(false);

    assert.doesNotThrow(() => cfg.resetState());
    const state = cfg.loadState();
    assert.ok(state.optOuts.fromBak, 'should recover broker entry from .bak');
    assert.equal(state.optOuts.fromBak.lastSuccess, '2025-06-01T00:00:00.000Z');
  } finally {
    cfg.setTestStatePath(null);
    cleanup(dir);
  }
});

test('resetState: corrupt primary AND corrupt .bak -> empty state, no throw', () => {
  const dir       = makeTmpDir();
  const statePath = path.join(dir, 'state.json');
  const bakPath   = statePath + '.bak';
  try {
    fs.writeFileSync(statePath, 'BAD JSON');
    fs.writeFileSync(bakPath,   'ALSO BAD JSON');

    cfg.setTestStatePath(statePath);
    cfg.setDryRun(false);

    assert.doesNotThrow(() => cfg.resetState());
    const state = cfg.loadState();
    assert.deepEqual(state, { optOuts: {} });
  } finally {
    cfg.setTestStatePath(null);
    cleanup(dir);
  }
});

test('resetState: corrupt primary AND missing .bak -> empty state, no throw', () => {
  const dir       = makeTmpDir();
  const statePath = path.join(dir, 'state.json');
  try {
    fs.writeFileSync(statePath, 'TRUNCATED');
    // no .bak file

    cfg.setTestStatePath(statePath);
    cfg.setDryRun(false);

    assert.doesNotThrow(() => cfg.resetState());
    const state = cfg.loadState();
    assert.deepEqual(state, { optOuts: {} });
  } finally {
    cfg.setTestStatePath(null);
    cleanup(dir);
  }
});

// ── Fix 2: saveState writes .bak atomically (via tmp+rename) ─────────────────

test('saveState: .bak is created via tmp-rename (no .bak.tmp left behind)', () => {
  const dir       = makeTmpDir();
  const statePath = path.join(dir, 'state.json');
  const bakPath   = statePath + '.bak';
  const bakTmp    = bakPath  + '.tmp';
  try {
    cfg.setTestStatePath(statePath);
    cfg.setDryRun(false);

    cfg.saveState();

    assert.ok(fs.existsSync(statePath), 'state.json should exist after save');
    assert.ok(fs.existsSync(bakPath),   '.bak should exist after save');
    assert.ok(!fs.existsSync(bakTmp),   '.bak.tmp must not be left behind');
  } finally {
    cfg.setTestStatePath(null);
    cleanup(dir);
  }
});

test('saveState: .bak content is valid JSON matching the saved state', () => {
  const dir       = makeTmpDir();
  const statePath = path.join(dir, 'state.json');
  const bakPath   = statePath + '.bak';
  try {
    cfg.setTestStatePath(statePath);
    cfg.setDryRun(false);

    const state = cfg.loadState();
    state.optOuts['__durability_test__'] = { lastSuccess: '2026-05-01T00:00:00.000Z' };
    cfg.saveState();
    delete state.optOuts['__durability_test__'];

    const primary = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const bak     = JSON.parse(fs.readFileSync(bakPath,   'utf8'));
    assert.deepEqual(bak, primary, '.bak should be byte-identical to state.json after save');
  } finally {
    cfg.setTestStatePath(null);
    cleanup(dir);
  }
});

test('saveState: resetState can recover from .bak after primary is deleted', () => {
  const dir       = makeTmpDir();
  const statePath = path.join(dir, 'state.json');
  const bakPath   = statePath + '.bak';
  try {
    cfg.setTestStatePath(statePath);
    cfg.setDryRun(false);

    const state = cfg.loadState();
    state.optOuts['__recover_test__'] = { lastSuccess: '2026-03-01T00:00:00.000Z' };
    cfg.saveState();
    delete state.optOuts['__recover_test__'];

    // Simulate corrupt/deleted primary
    fs.unlinkSync(statePath);
    assert.ok(fs.existsSync(bakPath), '.bak should exist to recover from');

    cfg.resetState();
    const recovered = cfg.loadState();
    assert.ok(recovered.optOuts['__recover_test__'], 'should recover entry from .bak');
  } finally {
    cfg.setTestStatePath(null);
    cleanup(dir);
  }
});

test('saveState: dry-run does not write .bak', () => {
  const dir       = makeTmpDir();
  const statePath = path.join(dir, 'state.json');
  const bakPath   = statePath + '.bak';
  try {
    cfg.setTestStatePath(statePath);
    cfg.setDryRun(true);

    cfg.saveState();

    assert.ok(!fs.existsSync(statePath), 'state.json must not be written in dry-run');
    assert.ok(!fs.existsSync(bakPath),   '.bak must not be written in dry-run');
  } finally {
    cfg.setTestStatePath(null);
    cfg.setDryRun(false);
    cleanup(dir);
  }
});

test('saveState: the .bak is a hard link to the saved file, not a second write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-bak-link-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realWriteFileSync = fs.writeFileSync;
  let writeFileCalls = 0;
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__link_test__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    fs.writeFileSync = (...a) => { writeFileCalls++; return realWriteFileSync(...a); };
    cfg.saveState();
    fs.writeFileSync = realWriteFileSync;
    assert.equal(writeFileCalls, 0, 'the .bak was written with writeFileSync instead of being linked');
    assert.equal(fs.statSync(bakPath).ino, fs.statSync(statePath).ino, '.bak shares the inode of state.json');
    assert.equal(fs.readFileSync(bakPath, 'utf8'), fs.readFileSync(statePath, 'utf8'));
  } finally {
    fs.writeFileSync = realWriteFileSync;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveState: an in-place fallback never writes through a .bak that shares the inode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-bak-detach-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realRename = fs.renameSync;
  const realWriteFileSync = fs.writeFileSync;
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__a__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    cfg.saveState(); // linked .bak
    const linkedIno = fs.statSync(statePath).ino;
    let bakDuringRewrite = null;
    // Make the primary rename fail like a bind-mounted file, and look at the
    // .bak at the moment the in-place write happens.
    fs.renameSync = (from, to) => {
      if (to === statePath) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; }
      return realRename(from, to);
    };
    fs.writeFileSync = (file, ...rest) => {
      if (file === statePath) {
        bakDuringRewrite = { ino: fs.statSync(bakPath).ino, text: fs.readFileSync(bakPath, 'utf8') };
      }
      return realWriteFileSync(file, ...rest);
    };
    cfg.loadState().optOuts.__b__ = { lastSuccess: '2026-01-02T00:00:00.000Z' };
    cfg.saveState();
    fs.renameSync = realRename;
    fs.writeFileSync = realWriteFileSync;
    assert.ok(bakDuringRewrite, 'the fallback ran');
    assert.notEqual(bakDuringRewrite.ino, linkedIno, '.bak was detached before the in-place write');
    assert.ok(bakDuringRewrite.text.includes('__a__') && !bakDuringRewrite.text.includes('__b__'), '.bak held the old state during the write');
    assert.ok(fs.readFileSync(statePath, 'utf8').includes('__b__'));
    assert.ok(fs.readFileSync(bakPath, 'utf8').includes('__b__'));
  } finally {
    fs.renameSync = realRename;
    fs.writeFileSync = realWriteFileSync;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveState: when the .bak cannot be detached, the save fails instead of writing through the shared inode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-bak-nodetach-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realRename = fs.renameSync;
  const realWriteFileSync = fs.writeFileSync;
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__a__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    cfg.saveState(); // linked .bak
    const first = fs.readFileSync(statePath, 'utf8');
    assert.equal(fs.statSync(bakPath).ino, fs.statSync(statePath).ino);
    const stateWrites = [];
    fs.renameSync = (from, to) => {
      if (to === statePath || to === bakPath) { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; }
      return realRename(from, to);
    };
    fs.writeFileSync = (file, ...rest) => {
      if (file === statePath || file === bakPath) stateWrites.push(file);
      return realWriteFileSync(file, ...rest);
    };
    cfg.loadState().optOuts.__b__ = { lastSuccess: '2026-01-02T00:00:00.000Z' };
    assert.throws(() => cfg.saveState(), /EPERM/);
    fs.renameSync = realRename;
    fs.writeFileSync = realWriteFileSync;
    assert.deepEqual(stateWrites, [], 'nothing was written in place through the shared inode');
    assert.equal(fs.readFileSync(statePath, 'utf8'), first);
    assert.equal(fs.readFileSync(bakPath, 'utf8'), first);
  } finally {
    fs.renameSync = realRename;
    fs.writeFileSync = realWriteFileSync;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveState: a locked save explains itself and says nothing was lost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-locked-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realRename = fs.renameSync;
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__a__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    cfg.saveState();
    fs.renameSync = (from, to) => {
      if (to === statePath || to === bakPath) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; }
      return realRename(from, to);
    };
    cfg.loadState().optOuts.__b__ = { lastSuccess: '2026-01-02T00:00:00.000Z' };
    assert.throws(() => cfg.saveState(), (e) => /could not be saved safely/.test(e.message) && /Nothing was lost/.test(e.message) && e.code === 'EPERM');
  } finally {
    fs.renameSync = realRename;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('saveState: a link count above one detaches the .bak even when inode numbers disagree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upec-wipe-nlink-'));
  const statePath = path.join(dir, 'state.json');
  const bakPath = statePath + '.bak';
  cfg.setTestStatePath(statePath);
  const realRename = fs.renameSync;
  const realStat = fs.statSync;
  const realOpen = fs.openSync;
  const realWriteFileSync = fs.writeFileSync;
  const opened = [];
  try {
    cfg.resetState();
    cfg.loadState().optOuts.__a__ = { lastSuccess: '2026-01-01T00:00:00.000Z' };
    cfg.saveState(); // linked .bak
    const linkedIno = realStat(statePath).ino;
    // drvfs-style lie: the .bak reports a different inode number.
    fs.statSync = (p, o) => {
      const s = realStat(p, o);
      if (p === bakPath) return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { ino: s.ino + 1 });
      return s;
    };
    fs.openSync = (p, flags, ...rest) => { opened.push([p, flags]); return realOpen(p, flags, ...rest); };
    let bakInoDuringRewrite = null;
    fs.writeFileSync = (p, ...rest) => {
      if (p === statePath) bakInoDuringRewrite = realStat(bakPath).ino;
      return realWriteFileSync(p, ...rest);
    };
    fs.renameSync = (from, to) => {
      if (to === statePath) { const e = new Error('EBUSY'); e.code = 'EBUSY'; throw e; }
      return realRename(from, to);
    };
    cfg.loadState().optOuts.__b__ = { lastSuccess: '2026-01-02T00:00:00.000Z' };
    cfg.saveState();
    assert.notEqual(bakInoDuringRewrite, null, 'the in-place fallback ran');
    assert.notEqual(bakInoDuringRewrite, linkedIno, 'the .bak was detached before the in-place write');
    assert.ok(opened.some(([p, f]) => p === bakPath + '.tmp' && f === 'r+'), 'the detached copy was opened for fsync');
  } finally {
    fs.renameSync = realRename;
    fs.statSync = realStat;
    fs.openSync = realOpen;
    fs.writeFileSync = realWriteFileSync;
    cfg.setTestStatePath(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
