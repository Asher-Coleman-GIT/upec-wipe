'use strict';
/**
 * lib/list-status.js - the broker table of `upec-wipe list`: what each broker
 * is waiting on, from its state.json entry. Brokers that do not apply to the
 * member (a states-limited one such as California DROP) and email brokers
 * (shown in the Email requests section) are left out.
 */
const { normalizeUsState } = require('./us-state');

const day = (iso) => (iso ? String(iso).slice(0, 10) : '-');
const FAILED = new Set(['error', 'captcha_failed']);

function brokerStatus(entry) {
  if (!entry) return { status: 'never run', date: '-' };
  const pending = entry.pendingConfirm || entry.pendingConfirmation;
  if (pending) return { status: 'awaiting confirm', date: day(pending.since || entry.lastAttempt) };
  if (entry.manual) return { status: 'do by hand', date: day(entry.manual.since) };
  if (entry.lastSuccess) return { status: 'success', date: day(entry.lastSuccess) };
  const history = entry.history || [];
  if (FAILED.has(history[history.length - 1])) return { status: 'failed', date: day(entry.lastAttempt) };
  return { status: 'attempted', date: day(entry.lastAttempt) };
}

// Unknown state (no config, or no state on file): show the broker.
function appliesToMember(broker, persons) {
  if (!Array.isArray(broker.states)) return true;
  const states = (persons || []).map(p => normalizeUsState(p && p.state)).filter(Boolean);
  return states.length === 0 || states.some(s => broker.states.includes(s));
}

function brokerRows(brokers, state, persons) {
  const optOuts = (state && state.optOuts) || {};
  return brokers
    .filter(b => b.method !== 'email' && appliesToMember(b, persons))
    .map(b => ({ name: b.name, ...brokerStatus(optOuts[b.name]) }));
}

module.exports = { brokerStatus, brokerRows };
