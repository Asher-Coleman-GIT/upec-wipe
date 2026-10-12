/**
 * lib/email.js
 *
 * Cross-platform email opt-out sender.
 *
 * Public API:
 *   sendOptOutEmails(brokers, cfg)
 *
 * Routing:
 *   cfg.email.smtp set → nodemailer (lazy-required, optional dep)
 *   no smtp configured → logResult(..., 'manual', ...) on all platforms
 *
 * nodemailer is listed as an optionalDependency in package.json. The lazy
 * require inside _sendViaSMTP means startup is never affected on machines that
 * lack the package.
 */

const { getPlatform } = require('./platform');
const configMod = require('./config');
const loggerMod = require('./logger');
const { stateKey } = require('./config');
const { smtpFromLeakReason, smtpLeakAdvice, relayConfigured, relayRequired } = require('./relay');
const { ensureNodeEgress } = require('./egress');
const { normalizeUsState, usStateName } = require('./us-state');

// EU country codes (EU member states) + GB (UK GDPR)
const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'GB',
]);

/**
 * Build the GDPR-flavored opt-out email body (EU + UK users).
 * Cites Article 17 (right to erasure) and Article 20 (data portability).
 * @param {object} person
 * @returns {string}
 */
function _buildBodyGDPR(person) {
  return [
    'To Whom It May Concern,',
    '',
    'I am writing to exercise my rights under the General Data Protection Regulation',
    '(GDPR). Specifically, I am requesting erasure of all personal data you hold',
    'about me, pursuant to Article 17 (right to erasure / "right to be forgotten").',
    'I also request a copy of any data held about me under Article 20 (right to',
    'data portability) before deletion.',
    '',
    `Name: ${person.fullName}`,
    `Location: ${person.city}, ${person.state} ${person.zip}`,
    `Email: ${person.email}`,
    `Phone: ${person.phoneFormatted}`,
    '',
    'Please confirm in writing that all profiles, records, and personally identifiable',
    'information have been removed. Under GDPR you are required to respond within',
    '30 days of receipt of this request.',
    '',
    'Thank you,',
    `${person.fullName}`,
  ].join('\n');
}

/**
 * Build the CCPA-flavored opt-out email body (US and other non-EU users).
 * @param {object} person
 * @returns {string}
 */
function _buildBodyCCPA(person) {
  return [
    'To Whom It May Concern,',
    '',
    'I am requesting the removal of all records associated with my personal information',
    'from your database, under CCPA and applicable privacy laws.',
    '',
    `Name: ${person.fullName}`,
    `Location: ${person.city}, ${person.state} ${person.zip}`,
    `Email: ${person.email}`,
    `Phone: ${person.phoneFormatted}`,
    '',
    'Please remove all profiles, records, and personally identifiable information',
    'and confirm removal within 30 days.',
    '',
    'Thank you,',
    `${person.fullName}`,
  ].join('\n');
}

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
 * Return the appropriate template builder function based on country code.
 * @param {string|undefined} country - ISO 3166-1 alpha-2 country code
 * @returns {function} Template builder: (person) => string
 */
function _pickTemplate(country) {
  if (country && EU_COUNTRIES.has(country.toUpperCase())) {
    return _buildBodyGDPR;
  }
  return _buildBodyCCPA;
}

/**
 * Build the plain-text opt-out email body from person data.
 * Routes to GDPR or CCPA template based on person.country.
 * @param {object} person
 * @returns {string}
 */
function _buildBody(person) {
  return _pickTemplate(person.country)(person);
}

// ─── nodemailer path (any OS when cfg.email.smtp configured) ─────────────────

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
    tls: { minVersion: 'TLSv1.2' },
  };
  if (!secure) opts.requireTLS = true;
  return opts;
}

/**
 * Send a single opt-out email via SMTP using nodemailer (lazy-required).
 *
 * @param {object} broker
 * @param {object} person
 * @param {object} smtpCfg          - { host, port, user, pass, from }
 * @param {string} [submissionEmail] - masked/relay address to advertise to the
 *   broker; when set it replaces person.email in the body and sets replyTo.
 * @param {number} [personCount]    - total number of persons in the run; used
 *   to derive the correct composite state key (matches broker-runner keying).
 */
async function _sendViaSMTP(broker, person, smtpCfg, submissionEmail, personCount) {
  const masked = !!submissionEmail && submissionEmail !== person.email;
  if (masked) {
    const leak = smtpFromLeakReason(smtpCfg, person);
    if (leak) {
      loggerMod.logResult(broker.name, 'manual', `${broker.emailTo} - not sent: ${leak}. ${smtpLeakAdvice(leak)}`);
      return;
    }
  }

  // Lazy require - nodemailer is optional; avoids startup error when absent.
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_) {
    loggerMod.logResult(broker.name, 'error', 'nodemailer not installed - run: npm install nodemailer');
    return;
  }

  const transporter = nodemailer.createTransport(smtpTransportOptions(smtpCfg));

  const contactEmail = submissionEmail || person.email;
  const bodyPerson = contactEmail === person.email ? person : { ...person, email: contactEmail };
  const body = _pickTemplate(bodyPerson.country)(bodyPerson);

  const mail = {
    from: masked ? smtpCfg.from : (smtpCfg.from || smtpCfg.user),
    to: broker.emailTo,
    subject: `Personal Data Removal Request - ${person.fullName}`,
    text: body,
  };
  if (submissionEmail) mail.replyTo = submissionEmail;

  try {
    await transporter.sendMail(mail);
    loggerMod.logResult(broker.name, 'success', `Email -> ${broker.emailTo}`);
    const key = stateKey(broker.name, person, personCount);
    configMod.recordSuccess(key, `email to ${broker.emailTo}`);
  } catch (err) {
    loggerMod.logResult(broker.name, 'error', `SMTP failed: ${err.message.slice(0, 60)}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the list of persons from cfg.
 * - If cfg.persons is a non-empty array, return it.
 * - If cfg.person exists (single-person legacy), return [cfg.person].
 * - Otherwise return [] (no persons configured).
 *
 * @param {object} cfg
 * @returns {object[]}
 */
function _getPersons(cfg) {
  if (Array.isArray(cfg?.persons) && cfg.persons.length > 0) return cfg.persons;
  if (cfg?.person) return [cfg.person];
  return [];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Send opt-out emails for all brokers with method:'email'.
 *
 * Supports both single-person (cfg.person) and multi-person (cfg.persons)
 * configuration. When cfg.persons is a non-empty array, one email is sent
 * per (broker, person) pair. Falls back to cfg.person for backward compat.
 *
 * @param {object[]} brokers   - Full broker list (filtered internally)
 * @param {object}   cfg       - Full config object (cfg.person/cfg.persons, cfg.email.smtp)
 * @param {string}   [_platform] - Injected for testing; defaults to process.platform
 * @param {object}   [opts]
 * @param {(person: object) => (string|undefined)} [opts.submissionEmailFor]
 *   Resolver returning a masked/relay email for a person; when it returns a
 *   value, that address is advertised to the broker instead of person.email.
 *   When a resolver is supplied, a relay is configured or required, and the
 *   resolver returns nothing for a person, that person is skipped: the real
 *   email is never the fallback.
 * @param {Set<object>} [opts.blockedPersons] - persons to skip entirely (their
 *   relay alias was unavailable this run).
 * @param {boolean} [opts.dryRun] - log a preview line per mail, send nothing.
 *
 * Log lines name a person only as "person #N", never by name or email.
 */
async function sendOptOutEmails(brokers, cfg, _platform, opts = {}) {
  const platform = getPlatform(_platform || process.platform);
  const persons = _getPersons(cfg);
  const smtpCfg = cfg?.email?.smtp;
  const hasResolver = typeof opts.submissionEmailFor === 'function';
  const submissionEmailFor = hasResolver ? opts.submissionEmailFor : (() => undefined);
  const blockedPersons = opts.blockedPersons || new Set();
  const relayOn = relayConfigured(cfg) || relayRequired(cfg);
  const dryRun = !!opts.dryRun;

  const emailBrokers = brokers.filter(b => b.method === 'email');
  const personCount = persons.length;

  for (const broker of emailBrokers) {
    for (let i = 0; i < persons.length; i++) {
      const person = persons[i];
      const label = `person #${i + 1}`;
      if (blockedPersons.has(person)) {
        loggerMod.logResult(broker.name, 'skipped', `${broker.emailTo} - ${label} blocked: no relay alias this run`);
        continue;
      }
      const submissionEmail = submissionEmailFor(person);
      if (hasResolver && !submissionEmail && relayOn) {
        loggerMod.logResult(broker.name, 'manual', `${broker.emailTo} - not sent for ${label}: no relay alias, and the real email is never used as a fallback`);
        continue;
      }
      // Dedupe per (broker, person): multi-person state is keyed "Broker|First Last".
      if (configMod.lastOptOutDaysAgo(stateKey(broker.name, person, personCount)) < configMod.RECHECK_DAYS) {
        loggerMod.logResult(broker.name, 'skipped', `Email already sent recently (${label})`);
        continue;
      }
      if (dryRun) {
        loggerMod.logResult(broker.name, 'skipped', `[preview] Email -> ${broker.emailTo} (${label}), not sent`);
        continue;
      }
      if (smtpCfg) {
        // SMTP is a Node-direct connection: fail closed off the VPN (audit M7).
        await ensureNodeEgress(cfg);
        await _sendViaSMTP(broker, person, smtpCfg, submissionEmail, personCount);
      } else {
        loggerMod.logResult(
          broker.name,
          'manual',
          `${broker.emailTo} - add email.smtp to config.json to send automatically`
        );
      }
    }
  }
}

module.exports = {
  sendOptOutEmails,
  buildUcpaRequest,
  smtpTransportOptions,
  // Internal exports for unit-testing
  _buildBody,
  _buildBodyGDPR,
  _buildBodyCCPA,
  _pickTemplate,
  _sendViaSMTP,
  _getPersons,
};
