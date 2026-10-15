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

// A by-hand broker or site with no record yet is already the member's to do.
function brokerStatus(entry, method) {
  if (!entry) return { status: method === 'manual' ? 'do by hand' : 'never run', date: '-' };
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
    .map(b => ({ name: b.name, ...brokerStatus(optOuts[b.name], b.method) }));
}

// Catalog sites as runs see them: the same names (their state keys), and none
// that an explicit broker already covers. The empty person keeps the member's
// details out; only names and methods are read.
function catalogRows(records, state, brokers) {
  const { catalogBrokersForPerson } = require('./catalog');
  const { explicitHostsOf } = require('./feeds');
  const optOuts = (state && state.optOuts) || {};
  const sites = catalogBrokersForPerson(records, {}, {
    explicitHosts: explicitHostsOf(brokers || []),
    explicitNames: new Set((brokers || []).map(b => b.name.toLowerCase())),
  });
  return sites.map(s => ({ name: s.name, ...brokerStatus(optOuts[s.name], s.method) }));
}

module.exports = { brokerStatus, brokerRows, catalogRows };
