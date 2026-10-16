'use strict';
/**
 * lib/read-email.js
 *
 * `upec-wipe read-email`: reads the dedicated request mailbox (the SMTP
 * account the email step sends from) read-only, matches each reply to the
 * broker that was emailed, suggests an outcome (lib/reply-classify.js) and
 * logs it as a `reply` only after the member says yes.
 *
 * Read-only by construction (lib/imap.js refuses anything but LOGIN, EXAMINE,
 * SEARCH, FETCH BODY.PEEK and LOGOUT). No link is ever opened: links are
 * shown as host and path, without query strings. Nothing about the messages
 * is written to disk. IMAP leaves from this machine, so the same rules as the
 * email step apply: Mullvad must be up, and a proxy or network.required false
 * is refused.
 */
const { classifyReply, combineOutcomes } = require('./reply-classify');
const { registrableDomain, hostnameOf } = require('./domain');
const { egressRequired, proxyFromConfig } = require('./egress');

const LOGGABLE = new Set(['honored', 'refused', 'verify', 'bounced']);
const LABEL = {
  honored: 'honored',
  verify: 'verify (they want you to confirm the request)',
  refused: 'refused (email not accepted; use their form)',
  bounced: 'bounced',
  pending: 'acknowledged, nothing to log yet',
  unknown: 'unclear, read it yourself',
};
const RANK = ['honored', 'verify', 'refused', 'bounced', 'pending', 'unknown'];
const FOLDERS = ['INBOX', '[Gmail]/Spam'];
const MAX_MESSAGES = 300;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const senderHost = (addr) => String(addr || '').split('@')[1] || '';
const label = (domain) => String(domain || '').split('.')[0];

/** The emailed broker a reply is from, or null (several candidates: null). */
function matchBroker(msg, targets) {
  const host = senderHost(msg.fromAddress).toLowerCase();
  const reg = registrableDomain(host);
  const exact = targets.filter(t => reg && (registrableDomain(senderHost(t.to)) === reg || t.domain === reg));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // Help desks and privacy platforms (spokeo.zendesk.com, "Privacy Team at
  // Four Leaf Data" <noreply@trustsuperset.com>, "[MonitorBase]" subjects).
  const hay = `${norm(host)} ${norm(msg.from)} ${norm(msg.subject)}`;
  const hits = targets.filter(t => [label(t.domain), label(senderHost(t.to))]
    .some(l => l.length >= 5 && hay.includes(norm(l))));
  const names = [...new Set(hits.map(t => t.name))];
  return names.length === 1 ? hits[0] : null;
}

/**
 * The brokers a reply can come from: today's email targets, explicit email
 * brokers, and any broker emailed before (one that refused email is manual
 * now, but its replies still arrive). Domain from the catalog record or the
 * broker entry when there is one, else from the address it was sent to.
 */
function emailedTargets({ catalogRecords = [], brokers = [], state = {} }) {
  const { catalogEmailTargets } = require('./catalog');
  const explicitNames = new Set(brokers.map(b => b.name.toLowerCase()));
  const out = catalogEmailTargets(catalogRecords, { explicitNames }).map(t => ({ name: t.name, to: t.to, domain: t.domain }));
  const domainOfUrl = (u) => registrableDomain(hostnameOf(u || ''));
  for (const b of brokers) {
    if (b.method === 'email' && b.emailTo) out.push({ name: b.name, to: String(b.emailTo).toLowerCase(), domain: domainOfUrl(b.optOutUrl) || registrableDomain(senderHost(b.emailTo)) });
  }
  const have = new Set(out.map(t => t.name));
  for (const [key, sent] of Object.entries(state.emailSent || {})) {
    const name = key.split('|')[0];
    if (have.has(name) || !sent || !sent.to) continue;
    have.add(name);
    const to = String(sent.to).toLowerCase();
    const toDomain = registrableDomain(senderHost(to));
    const rec = catalogRecords.find(r => r.domain === toDomain || (r.formHosts || []).includes(toDomain)) ||
      catalogRecords.find(r => r.name && r.name.toLowerCase().startsWith(name.toLowerCase()));
    const broker = brokers.find(b => b.name === name);
    out.push({ name, to, domain: (rec && rec.domain) || (broker && domainOfUrl(broker.optOutUrl)) || registrableDomain(senderHost(to)) });
  }
  return out;
}

function imapHostFor(smtpHost) {
  const h = String(smtpHost || '').toLowerCase();
  if (h === 'smtp.gmail.com' || h === 'smtp.googlemail.com') return 'imap.gmail.com';
  return h.replace(/^smtp\./, 'imap.');
}

// "https://host/path?x=1" -> "host/path": a link to look at, not to follow.
function linkLocation(url) {
  const m = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(String(url));
  return m ? `${m[1].toLowerCase()}${m[2].slice(0, 80) || '/'}` : null;
}
// Opt-out and form pages first, help-desk tickets and articles last.
function linkOrder(locs) {
  const score = (l) => (/opt-?out|remov|delete|data-?request|privacy-?choices|your-privacy|webform|request-?form|my-data|\/form/i.test(l) ? 0
    : /\/(hc|requests?|tickets?|articles?|automatic-answers)\b/i.test(l) ? 2 : 1);
  return [...locs].sort((a, b) => score(a) - score(b));
}
const NOISE_LINK = /\.(png|jpe?g|gif|svg)$|\/(unsubscribe|ratings?)\b|zendesk\.com\/(support|requests\/automatic)|intercom\.com|linkedin\.com|facebook\.com|twitter\.com|go\.microsoft\.com/i;

const keysFor = (map, name) => Object.keys(map || {}).filter(k => k === name || k.startsWith(`${name}|`));
function loggedOutcome(state, name) {
  const replies = (state && state.emailReplies) || {};
  const rows = keysFor(replies, name).map(k => replies[k]).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return rows.length ? rows[0].outcome : null;
}
const shellName = (n) => (/^[\w.-]+$/.test(n) ? n : `"${n}"`);

function parseSince(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {{ since?: string }} opts
 * @param {object} deps  config, state, targets, ensureEgress, openMailbox,
 *   parseMessage, isTTY, ask, log, logReply(name, outcome)
 * @returns {Promise<number>} exit code
 */
async function readEmail(opts, deps) {
  const { config, state, targets, log } = deps;
  const smtp = config && config.email && config.email.smtp;
  if (!smtp || !smtp.host || !smtp.user || !smtp.pass) {
    log('read-email needs the email.smtp block in config.json (run setup): it reads the mailbox the email requests were sent from.');
    return 2;
  }
  let proxy = null;
  try { proxy = proxyFromConfig(config); } catch (_) { proxy = 'invalid'; }
  if (proxy) {
    log('network.proxy covers the browser only, so the mailbox would be read from your real IP; use the Mullvad app instead of a proxy.');
    return 1;
  }
  if (!egressRequired(config)) {
    log('network.required is false, so nothing would check that the mailbox is read through Mullvad; read-email refuses to run.');
    return 1;
  }

  let since;
  if (opts.since !== undefined && opts.since !== null) {
    since = parseSince(opts.since);
    if (!since) { log('Usage: upec-wipe read-email [--since YYYY-MM-DD]'); return 2; }
  } else {
    const sent = Object.values((state && state.emailSent) || {}).map(v => v && v.at).filter(Boolean).sort();
    if (!sent.length) { log('No email requests are recorded yet, so there is nothing to read. To read anyway: upec-wipe read-email --since YYYY-MM-DD'); return 2; }
    since = new Date(`${String(sent[0]).slice(0, 10)}T00:00:00Z`);
  }

  try {
    await deps.ensureEgress(config);
  } catch (err) {
    log(`${err.message} - the mailbox was not opened.`);
    return 1;
  }

  const imap = (config.email && config.email.imap) || {};
  const mailbox = await deps.openMailbox({ host: imap.host || imapHostFor(smtp.host), port: imap.port || 993, user: smtp.user, pass: smtp.pass });
  const messages = [];
  let unreadable = 0;
  try {
    for (const folder of FOLDERS) {
      if (!(await mailbox.examine(folder))) continue;
      const ids = (await mailbox.searchSince(since)).slice(-MAX_MESSAGES);
      for (const id of ids) {
        // Untrusted mail: one message the parser cannot read is skipped, not
        // the whole run (review 2026-10-15).
        let m;
        try { m = deps.parseMessage(await mailbox.fetchMessage(id)); } catch (_) { unreadable++; continue; }
        messages.push({ ...m, folder: folder === 'INBOX' ? 'inbox' : 'spam' });
      }
    }
  } finally {
    await mailbox.logout();
  }

  const byBroker = new Map();
  const other = [];
  for (const m of messages) {
    const t = matchBroker(m, targets);
    if (!t) { other.push(m); continue; }
    if (!byBroker.has(t.name)) byBroker.set(t.name, []);
    byBroker.get(t.name).push({ m, c: classifyReply(m) });
  }

  log(`\nRead ${messages.length} message(s) since ${since.toISOString().slice(0, 10)} (inbox and spam). Nothing in the mailbox was changed and no link was opened.`);
  if (unreadable) log(`${unreadable} message${unreadable === 1 ? '' : 's'} could not be read and ${unreadable === 1 ? 'was' : 'were'} skipped: check the mailbox by hand.`);
  const rows = [...byBroker.entries()].map(([name, items]) => {
    const outcome = combineOutcomes(items.map(i => i.c.outcome));
    const best = items.find(i => i.c.outcome === outcome);
    const links = linkOrder([...new Set(items.flatMap(i => i.m.links || []).map(linkLocation).filter(l => l && !NOISE_LINK.test(l)))]).slice(0, 4);
    const emailed = keysFor(state && state.emailSent, name).length > 0;
    const logged = loggedOutcome(state, name);
    return { name, outcome, evidence: best.c.evidence, links, count: items.length, spam: items.some(i => i.m.folder === 'spam'), emailed, logged };
  }).sort((a, b) => RANK.indexOf(a.outcome) - RANK.indexOf(b.outcome) || a.name.localeCompare(b.name));

  for (const r of rows) {
    const notes = [`${r.count} message${r.count === 1 ? '' : 's'}`, r.spam ? 'in spam' : null, r.emailed ? null : 'not emailed by this tool',
      r.logged ? `already logged as ${r.logged}` : null].filter(Boolean).join(', ');
    log(`\n${r.name} - ${LABEL[r.outcome]} (${notes})`);
    if (r.evidence) log(`   "${r.evidence}"`);
    if (r.links.length) log(`   Links (not opened): ${r.links.join(' | ')}`);
  }
  if (other.length) {
    log(`\nOther messages (${other.length}), not from a broker that was emailed:`);
    for (const m of other) log(`   ${m.date ? m.date.toISOString().slice(0, 10) : '?'}  ${m.from || m.fromAddress} - ${m.subject}`);
  }

  const commands = [];
  let asked = false;
  for (const r of rows) {
    if (!LOGGABLE.has(r.outcome) || !r.emailed) continue;
    if (r.logged === r.outcome) continue;
    if (!deps.isTTY) { commands.push(`upec-wipe reply ${shellName(r.name)} ${r.outcome}`); continue; }
    if (!asked) { log('\nLog the suggested outcomes (Enter skips):'); asked = true; }
    const ans = await deps.ask(`   Log ${r.name} as ${r.outcome}? [y/N] `);
    if (/^y(es)?$/i.test(String(ans).trim())) deps.logReply(r.name, r.outcome);
  }
  if (commands.length) {
    log('\nNo terminal to ask in. To log the suggested outcomes, run:');
    for (const c of commands) log(`   ${c}`);
  }
  return 0;
}

module.exports = { readEmail, matchBroker, emailedTargets, imapHostFor, linkLocation, linkOrder };
