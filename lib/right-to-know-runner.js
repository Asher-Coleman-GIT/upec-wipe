/**
 * lib/right-to-know-runner.js
 *
 * Orchestrates right-to-know (data access / disclosure) requests for
 * email-capable brokers.
 *
 * Public API:
 *   sendKnowRequests(brokers, cfg, opts) -> { sent, manual, errors }
 *
 * Routing mirrors lib/email.js:
 *   cfg.email.smtp set (and not dry-run) -> nodemailer (lazy-required)
 *   no smtp -> logResult(..., 'manual', <template>) so the user can copy-paste
 *
 * On a real send (or a manual print) the broker is recorded via
 * configMod.recordKnowRequest. In dry-run nothing is sent and no state is
 * written (dry-run promises no persisted state), but a preview is still logged.
 */

const configMod = require('./config');
const loggerMod = require('./logger');
const { buildKnowRequest } = require('./right-to-know');
const { smtpFromLeakReason } = require('./relay');

/**
 * Send one know-request via SMTP using nodemailer (lazy-required).
 * Returns true on success, false on failure (failure is logged).
 *
 * @param {object} broker
 * @param {{ subject: string, body: string }} request
 * @param {object} smtpCfg
 * @param {string} [replyTo] - masked/relay address to set as replyTo when an
 *   alias is in play for this request
 * @returns {Promise<boolean>}
 */
async function _sendViaSMTP(broker, request, smtpCfg, replyTo) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_) {
    loggerMod.logResult(broker.name, 'error', 'nodemailer not installed - run: npm install nodemailer');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: smtpCfg.host,
    port: smtpCfg.port || 587,
    secure: (smtpCfg.port || 587) === 465,
    auth: { user: smtpCfg.user, pass: smtpCfg.pass },
  });

  try {
    await transporter.sendMail({
      from: smtpCfg.from || smtpCfg.user,
      to: broker.emailTo,
      subject: request.subject,
      text: request.body,
      ...(replyTo ? { replyTo } : {}),
    });
    loggerMod.logResult(broker.name, 'success', `Know request -> ${broker.emailTo}`);
    return true;
  } catch (err) {
    loggerMod.logResult(broker.name, 'error', `SMTP failed: ${err.message.slice(0, 60)}`);
    return false;
  }
}

/**
 * Resolve persons from cfg. Reuses configMod.getPersonsFromConfig so the set
 * matches what watcher.js iterates over.
 * @param {object} cfg
 * @returns {object[]}
 */
function _getPersons(cfg) {
  try {
    return configMod.getPersonsFromConfig(cfg);
  } catch (_) {
    return [];
  }
}

/**
 * Send right-to-know requests for all email-method brokers.
 *
 * @param {object[]} brokers - full broker list (filtered internally)
 * @param {object}   cfg      - full config (cfg.person/cfg.persons, cfg.email.smtp)
 * @param {object}   [opts]
 * @param {boolean}  [opts.dryRun] - when true, print previews but do not send or record
 * @param {(person: object) => (string|undefined)} [opts.submissionEmailFor]
 *   Resolver returning a masked/relay email for a person; when it returns a
 *   value, that address replaces person.email in the request and is set as
 *   replyTo.
 * @param {Set<object>} [opts.blockedPersons] - persons to skip entirely (e.g.
 *   relay alias unavailable for them this run).
 * @returns {Promise<{ sent: string[], manual: string[], errors: {name:string,error:string}[] }>}
 */
async function sendKnowRequests(brokers, cfg, opts = {}) {
  const dryRun = !!opts.dryRun;
  const persons = _getPersons(cfg);
  const smtpCfg = cfg && cfg.email && cfg.email.smtp;
  const emailBrokers = brokers.filter(b => b.method === 'email');
  const submissionEmailFor = opts.submissionEmailFor || (() => undefined);
  const blockedPersons = opts.blockedPersons || new Set();

  const sent = [];
  const manual = [];
  const errors = [];

  for (const broker of emailBrokers) {
    for (const person of persons) {
      if (blockedPersons.has(person)) continue;
      const alias = submissionEmailFor(person);
      const masked = !!alias && alias !== person.email;
      const request = buildKnowRequest({ person: masked ? { ...person, email: alias } : person, broker });
      const leak = masked && smtpCfg ? smtpFromLeakReason(smtpCfg, person) : null;

      if (dryRun) {
        loggerMod.logResult(
          broker.name,
          'skipped',
          `[preview] Right-to-know -> ${broker.emailTo} (${request.subject})`
        );
        continue;
      }

      if (smtpCfg && leak) {
        loggerMod.logResult(broker.name, 'manual', `Right-to-know -> ${broker.emailTo} not sent: ${leak}. Set email.smtp.from to a non-real address.`);
        manual.push(broker.name);
        continue;
      }

      if (smtpCfg) {
        const ok = await _sendViaSMTP(broker, request, smtpCfg, masked ? alias : undefined);
        if (ok) {
          // Thread person + count so multi-person runs key per person via
          // stateKey, matching recordSuccess / the verify-loop (B6).
          configMod.recordKnowRequest(broker.name, person, persons.length);
          sent.push(broker.name);
        } else {
          errors.push({ name: broker.name, error: 'send failed' });
        }
      } else {
        loggerMod.logResult(
          broker.name,
          'manual',
          `Right-to-know -> ${broker.emailTo} - ${request.subject}\n${request.body}`
        );
        configMod.recordKnowRequest(broker.name, person, persons.length);
        manual.push(broker.name);
      }
    }
  }

  return { sent, manual, errors };
}

module.exports = {
  sendKnowRequests,
  _sendViaSMTP,
  _getPersons,
};
