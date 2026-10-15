'use strict';
/**
 * lib/reply-classify.js
 *
 * Suggests what a broker's reply to an email request means, for
 * `upec-wipe read-email`, with the sentence it based that on. Outcomes are the
 * `reply` ones (honored, refused, verify, bounced) plus "pending" (received,
 * nothing to log yet) and "unknown". Only a suggestion: the member confirms
 * each one before it is logged.
 *
 * Patterns come from the replies of 2026-10-15. Our own letter, quoted below
 * many replies, is cut off first: it says "Please confirm when this is done".
 */

// Where the quoted original starts (our letter, or a mail client's header).
const QUOTE_MARKERS = [
  /^\s*>?\s*To the privacy team,/m,
  /^On .{4,160}wrote:\s*$/m,
  /^-{3,}\s*Original Message\s*-{3,}/im,
  /^-{5,}\s*$/m,
  /^From: .+\r?\n(Sent|Date): /m,
  /^>/m,
];

function stripQuoted(text) {
  const s = String(text || '');
  let cut = s.length;
  for (const re of QUOTE_MARKERS) {
    // The first marker with the reply's own text above it (a help desk may
    // put a dashed divider before its answer).
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = g.exec(s)) !== null) {
      if (s.slice(0, m.index).trim().length > 0) { if (m.index < cut) cut = m.index; break; }
      if (m[0].length === 0) g.lastIndex++;
    }
  }
  return s.slice(0, cut);
}

// Checked in this order; the first that matches decides.
const RULES = [
  ['honored', [
    /\b(has|have) been (completed|processed|fulfilled|honou?red)\b/i,
    /\bwe have (processed|completed|fulfilled|honou?red) your request\b/i,
    /\bmarked (this|your) request as completed\b/i,
    /\b(added|placed) (to|on) (our|the) suppression list/i,
    /\b(do|does) not (hold|have|maintain) any (personal )?(data|information|records?)\b(?! .*(form|portal))/i,
    /\bdid not find any (profiles?|records?|data|information)\b/i,
    /\bnot been found in our (database|system|records)\b/i,
    /\bhas been (permanently )?(removed|deleted)\b/i,
    /\bno longer (possesses|holds|has) (any )?personal (data|information)\b/i,
  ]],
  ['verify', [
    /\bowner\/controller\b/i,
    /\bplease confirm by (clicking|responding|replying)\b/i,
    /\bconfirm (that )?you are (the owner|the person)\b/i,
    /\bverify your (identity|email address)\b(?!.*(form|portal))/i,
  ]],
  ['refused', [
    /\b(unable|not able) to (accept|receive|review|process)\b[^.]*\b(e-?mail|requests?)\b/i,
    /\b(cannot|can ?not|will not|won'?t) be processed\b/i,
    /\bhas not been processed\b/i,
    /\bmust be submitted\b/i,
    /\bplease (submit|use|visit|complete|utilize|fill out)\b[^.]*\b(form|portal|web ?form|link|webpage|methods?|tool)\b/i,
    /\b(fill out|complete) the (appropriate |following |removal |online )?(web ?form|form)\b/i,
    /\bself-service tool\b/i,
    /\b(privacy|consumer) (request|choices) (form|portal)\b/i,
    /\b(visit|use) our [^.]{0,40}\b(portal|web ?form|form)\b/i,
    /\bdesignated method/i,
    /\bpermitted methods\b/i,
  ]],
  ['pending', [
    /\b(we have|we've) received your (request|email|message)\b/i,
    /\bwe(?:'ll| will) (review|process|respond)\b/i,
    /\b(will|shall) process (it|your request)\b/i,
    /\breceipt and acknowledg/i,
    /\backnowledge receipt\b/i,
    /\ba (new )?request \(?\d+\)? has been created\b/i,
    /\bhas been created\b/i,
  ]],
];

const BOUNCE_FROM = /^(postmaster|mailer-daemon|mail-daemon)@/i;
const BOUNCE_SUBJECT = /\b(undeliverable|delivery status notification|delivery (has )?failed|returned mail|mail delivery (failed|subsystem))\b/i;

// A sentence ends at . ! or ? followed by a space or the end, so the dots
// inside a link (catalist.us/...) do not cut it.
function sentenceAround(text, index) {
  let start = 0;
  const before = /[.!?]\s/g;
  let m;
  while ((m = before.exec(text)) !== null && m.index < index) start = m.index + 2;
  const after = /[.!?](\s|$)/g;
  after.lastIndex = index;
  const e = after.exec(text);
  const end = e ? e.index + 1 : text.length;
  // Links in the quote keep host and path only (query strings carry tokens).
  return text.slice(start, end).trim().replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1').slice(0, 220);
}

/**
 * @param {{ text: string, subject?: string, fromAddress?: string }} msg
 * @returns {{ outcome: string, evidence: string }}
 */
function classifyReply({ text, subject = '', fromAddress = '' }) {
  if (BOUNCE_FROM.test(fromAddress) || BOUNCE_SUBJECT.test(subject)) {
    return { outcome: 'bounced', evidence: subject || 'delivery failure notice' };
  }
  // One line of single spaces: phrases broken by a line wrap or a
  // non-breaking space still match.
  const body = stripQuoted(text).replace(/[\s\u00a0]+/g, ' ').trim();
  for (const [outcome, patterns] of RULES) {
    for (const re of patterns) {
      const m = re.exec(body);
      if (m) return { outcome, evidence: sentenceAround(body, m.index) };
    }
  }
  return { outcome: 'unknown', evidence: body.replace(/\s+/g, ' ').trim().slice(0, 160) };
}

// One broker, several replies: a final answer beats an acknowledgement.
const RANK = ['honored', 'verify', 'refused', 'bounced', 'pending', 'unknown'];
function combineOutcomes(outcomes) {
  return [...outcomes].sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0] || 'unknown';
}

module.exports = { classifyReply, stripQuoted, combineOutcomes };
