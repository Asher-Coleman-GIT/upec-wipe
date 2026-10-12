/**
 * lib/email.js
 *
 * Email helpers for the --email and --know steps (lib/email-step.js,
 * lib/right-to-know-runner.js): the Utah request letter and the nodemailer
 * transport options. Sending lives in lib/email-step.js.
 */

const { normalizeUsState, usStateName } = require('./us-state');

const UCPA_SUBJECT = 'Privacy request: opt out of sale and targeted advertising, and delete';

/**
 * Phase 2 request letter (docs/superpowers/specs/2026-10-11-phase2-email-design.md).
 * Identifies the person by name, city and state only. `contact` is the
 * dedicated sending mailbox; nothing else about the person goes in.
 * @param {object} person
 * @param {string} contact
 * @returns {{ subject: string, body: string }}
 */
function buildUcpaRequest(person, contact) {
  const name = person.fullName || [person.firstName, person.lastName].filter(Boolean).join(' ');
  const stateName = usStateName(person.state) || String(person.state || '');
  const opening = normalizeUsState(person.state) === 'UT'
    ? 'I am a Utah resident. Under the Utah Consumer Privacy Act (Utah Code Title 13, Chapter 61) and any other privacy law that applies, I ask you to:'
    : `I live in ${stateName}. Under the privacy law that applies to me, I ask you to:`;
  const body = [
    'To the privacy team,',
    '',
    opening,
    '',
    '1. stop selling or sharing my personal data;',
    '2. stop processing my personal data for targeted advertising; and',
    '3. delete my personal data.',
    '',
    'Details to locate my records:',
    `Name: ${name}`,
    `Location: ${[person.city, stateName].filter(Boolean).join(', ')}`,
    '',
    `Please confirm when this is done by replying to ${contact}.`,
    '',
    'Thank you,',
    name,
  ].join('\n');
  return { subject: UCPA_SUBJECT, body };
}

/**
 * nodemailer transport options for an smtp config block. Shared by the opt-out
 * and right-to-know senders (audit M5): port 465 is implicit TLS; every other
 * port must upgrade with STARTTLS (requireTLS), so a stripped STARTTLS fails
 * the send instead of sending AUTH and PII bodies in clear text. TLS 1.2 is
 * the minimum either way.
 *
 * @param {object} smtpCfg - { host, port, user, pass }
 * @returns {object}
 */
function smtpTransportOptions(smtpCfg) {
  const port = Number(smtpCfg.port) || 587;
  const secure = port === 465;
  const opts = {
    host: smtpCfg.host,
    port,
    secure,
    auth: { user: smtpCfg.user, pass: smtpCfg.pass },
    // EHLO name: nodemailer would send os.hostname(), and Gmail copies it into
    // the Received header the broker sees.
    name: 'localhost',
    tls: { minVersion: 'TLSv1.2' },
  };
  if (!secure) opts.requireTLS = true;
  return opts;
}

module.exports = {
  buildUcpaRequest,
  smtpTransportOptions,
};
