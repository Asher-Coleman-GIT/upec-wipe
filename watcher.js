#!/usr/bin/env node
/**
 * upec-wipe - watcher.js (thin orchestrator)
 *
 * Automated data broker opt-out runner. Internals live in lib/ (config,
 * logger, notify, captcha, forms, broker-runner, platform).
 * Run: node watcher.js   (add --dry-run to fill forms without submitting)
 */

// Audit M2: everything this process creates (run logs, audit files, snapshots,
// complaints, reports, config rewrites) is owner-only, however it was launched.
process.umask(0o077);

const path = require('path');
const fs   = require('fs');
const os   = require('os');

const { STATE_PATH, RECHECK_DAYS, loadConfig, loadState, saveState, recordSuccess, setDryRun, getPersonsFromConfig, loadCheckpoint, clearCheckpoint, findResumeIndex, configErrorReason } = require('./lib/config');
const { loadChromium } = require('./lib/playwright-loader');
const { results, logResult, buildSummary, setDefunctBrokers } = require('./lib/logger');
const { findDefunct, DEFUNCT_THRESHOLD } = require('./lib/defunct');
const { openInBrowser } = require('./lib/notify');
const brokerRunner = require('./lib/broker-runner');
const { isGenericEnabled, buildSubmissionPlan, submissionOptions, withSubmissionEmail } = require('./lib/submission-plan');
const { PREVIEW_ALIAS } = require('./lib/relay');
// Printed once when a preview/dry-run person has no cached alias yet.
const PREVIEW_ALIAS_NOTE = `ℹ  Preview: no SimpleLogin alias was created; using ${PREVIEW_ALIAS} as a stand-in. A real run creates the alias.`;
const lock = require('./lib/lock');
const { applyFilter, loadLastLog, extractFailedBrokers } = require('./lib/filter');
const { addToAllowlist, removeFromAllowlist, parseAllowlistArgs } = require('./lib/allowlist-edit');
const { diffResults, loadPreviousLog } = require('./lib/diff');
const { renderAuditMarkdown, writeAuditFile, timestampForFilename } = require('./lib/audit');
const { buildStealthScript } = require('./lib/stealth');
const { resolveHeadless, isLowMemory } = require('./lib/browser');
const { openBrowserSession, EgressError } = require('./lib/browser-session');
// Node-direct calls (SimpleLogin, CapSolver, HIBP, SMTP, registries) are gated
// by lib/egress ensureNodeEgress, which reads the config given here (audit M7).
const { setEgressConfig, ensureNodeEgress } = require('./lib/egress');
const { installSignalCleanup } = require('./lib/shutdown');
require('./lib/privilege').exitIfRoot();

// One line of input from the terminal.
function askLine(question) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, a => { rl.close(); resolve(a); });
  });
}

// Terminal, transport and gate wiring shared by the --email and --know steps.
function emailStepIo() {
  const nodemailer = require('nodemailer');
  const { smtpTransportOptions } = require('./lib/email');
  return {
    isTTY: !!process.stdin.isTTY,
    ask: askLine,
    log: (l) => console.log(l),
    makeTransport: (smtp) => nodemailer.createTransport(smtpTransportOptions(smtp)),
    ensureEgress: (cfg) => ensureNodeEgress(cfg, { fresh: true }),
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  };
}

// Audit M1: noise mode filled its "bogus" forms with the real person's name and
// alias and could mark real opt-outs done. It is disabled in this fork; refuse
// before any config is read or any browser module is loaded.
if (process.argv.includes('--pollute')) {
  console.error('--pollute is disabled in this fork: it submitted real personal data. See docs/THREAT-MODEL.md.');
  process.exit(1);
}

// Runs are manual only in this fork. Refuse the old flag rather than let it fall
// through to a real opt-out run.
if (process.argv.includes('--install-scheduler')) {
  console.error('--install-scheduler was removed: this fork runs only when you start it.');
  process.exit(1);
}

const PREVIEW           = process.argv.includes('--preview');
// Phase 2: --email sends the email requests, --forms fills web forms. A plain
// run is --forms only, so a scheduled run can never send email.
const EMAIL             = process.argv.includes('--email');
const FORMS             = process.argv.includes('--forms') || !EMAIL;
if (EMAIL && process.argv.includes('--verify')) {
  console.error('--email cannot be combined with --verify.');
  process.exit(1);
}
// --assist: pause on bot-protection checks so the member can clear them in the
// browser window (lib/assist.js). Needs a visible window; refuse before any work.
const ASSIST            = process.argv.includes('--assist');
if (ASSIST && resolveHeadless()) {
  console.error('--assist needs a visible browser window (a desktop session, not HEADLESS=1 or a display-less server).');
  process.exit(1);
}
const DRY_RUN           = process.argv.includes('--dry-run') || PREVIEW; // --preview implies --dry-run
const VERIFY            = process.argv.includes('--verify');
const SERP_SCAN         = process.argv.includes('--serp-scan');
const SERP_WATCH        = process.argv.includes('--serp-watch');
const DOCTOR            = process.argv[2] === 'doctor' || process.argv.includes('--doctor');

// ── Filter flags ──────────────────────────────────────────────────────────────
const onlyIdx   = process.argv.indexOf('--only');
const ONLY_ARG  = onlyIdx !== -1 ? (process.argv[onlyIdx + 1] || '') : null;
const skipIdx   = process.argv.indexOf('--skip');
const SKIP_ARG  = skipIdx !== -1 ? (process.argv[skipIdx + 1] || '') : null;
const RETRY_FAILED = process.argv.includes('--retry-failed');
const LIST_MODE    = process.argv.includes('--list');
const SCORE_MODE   = process.argv.includes('--score');

const PENDING_MODE    = process.argv.includes('--pending');
const UPDATE_BROKERS  = process.argv.includes('--update-brokers');
const BREACH_CHECK    = process.argv.includes('--breach-check');
const NO_CAPSOLVER    = process.argv.includes('--no-capsolver');
const RESUME          = process.argv.includes('--resume');
const SNAPSHOT        = process.argv.includes('--snapshot');
const REPORT          = process.argv.includes('--report');

// -- Config-encryption migration flags (run before any pipeline work) ---------
const ENCRYPT_CONFIG  = process.argv.includes('--encrypt-config');
const DECRYPT_CONFIG  = process.argv.includes('--decrypt-config');
const KEEP_PLAINTEXT  = process.argv.includes('--keep-plaintext');
const KNOW_MODE       = process.argv.includes('--know');
const KNOW_STATUS     = process.argv.includes('--know-status');
const COMPLAINTS_MODE = process.argv.includes('--complaints');

// ── Credit / identity freeze guided checklist ────────────────────────────────
const FREEZE_LIST = process.argv.includes('--freeze');
const freezeDoneIdx  = process.argv.indexOf('--freeze-done');
const FREEZE_DONE_KEY  = freezeDoneIdx !== -1 ? (process.argv[freezeDoneIdx + 1] || '') : null;
const freezeClearIdx = process.argv.indexOf('--freeze-clear');
const FREEZE_CLEAR_KEY = freezeClearIdx !== -1 ? (process.argv[freezeClearIdx + 1] || '') : null;
const FREEZE_MODE = FREEZE_LIST || FREEZE_DONE_KEY !== null || FREEZE_CLEAR_KEY !== null;

// ── --confirm-emails [dir]: auto-click confirmation links in .eml files ───────
const confirmEmailsIdx = process.argv.indexOf('--confirm-emails');
const CONFIRM_EMAILS = confirmEmailsIdx !== -1;
// Optional dir argument: next argv element if it doesn't start with '--'
const confirmEmailsDir = (() => {
  if (!CONFIRM_EMAILS) return './inbox/confirms';
  const next = process.argv[confirmEmailsIdx + 1];
  return (next && !next.startsWith('--')) ? next : './inbox/confirms';
})();

// ── --freeze / --freeze-done <key> / --freeze-clear <key> ─────────────────────
// Guided credit/identity freeze checklist. Pure guidance + tracking; no browser
// is launched. Subcommands persist state.freezes under the same state lock as a
// normal run so a concurrent run cannot race the write.
if (FREEZE_MODE) {
  const { FREEZE_TARGETS, getFreezeStatus, recordFreezeDone, recordFreezeCleared, TARGET_KEYS } = require('./lib/freeze');
  const state = loadState();

  // Mutating subcommands take the lock; the read-only list does not need it.
  const isMutation = FREEZE_DONE_KEY !== null || FREEZE_CLEAR_KEY !== null;
  const FREEZE_LOCK_PATH = STATE_PATH + '.lock';
  if (isMutation) {
    try {
      lock.acquire(FREEZE_LOCK_PATH);
    } catch (err) {
      const pidMatch = err.message.match(/pid (\d+)/);
      console.error(`Another instance is running, pid=${pidMatch ? pidMatch[1] : '?'}. Exiting.`);
      process.exit(1);
    }
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

// -- --encrypt-config / --decrypt-config: at-rest encryption migration --------
if (ENCRYPT_CONFIG || DECRYPT_CONFIG) {
  const { encryptConfigToDisk, decryptConfigToDisk, getPassphrase, PASSPHRASE_ENV } = require('./lib/config');
  if (!getPassphrase()) {
    console.error(`No passphrase. Create ~/.config/upec-wipe/passphrase (chmod 600), or set ${PASSPHRASE_ENV} or UPEC_WIPE_PASSPHRASE_FILE, and re-run.`);
    process.exit(1);
  }
  try {
    if (ENCRYPT_CONFIG) {
      const res = encryptConfigToDisk({ shred: !KEEP_PLAINTEXT });
      console.log(`\nEncrypted config written to ${res.encPath}`);
      console.log(res.shredded
        ? '   Plaintext config.json shredded.'
        : '   Plaintext config.json kept (--keep-plaintext).');
      console.log(`   Decrypt later with: node watcher.js --decrypt-config\n`);
    } else {
      const res = decryptConfigToDisk({ removeEnc: true });
      console.log(`\nDecrypted plaintext config written to ${res.configPath}`);
      console.log('   Encrypted config.json.enc removed.\n');
    }
    process.exit(0);
  } catch (err) {
    console.error(`Config migration failed: ${configErrorReason(err)}`);
    process.exit(1);
  }
}

// ── --list: print all brokers + status from state.json, then exit ────────────
if (LIST_MODE) {
  const brokers = require('./brokers');
  const state   = loadState();
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('Broker', 40) + pad('Status', 18) + 'Last opt-out');
  console.log('-'.repeat(80));
  for (const b of brokers) {
    const entry = state.optOuts && state.optOuts[b.name];
    const status = entry ? (entry.lastSuccess ? 'success' : 'pending') : 'never run';
    const last   = entry && entry.lastSuccess ? entry.lastSuccess.slice(0, 10) : '-';
    console.log(pad(b.name, 40) + pad(status, 18) + last);
  }
  const { loadCatalog, catalogSummary } = require('./lib/catalog');
  const catalog = catalogSummary(loadCatalog());
  if (catalog.length) {
    console.log(`\nCatalog sites (${catalog.length})`);
    console.log('-'.repeat(80));
    for (const c of catalog) {
      const entry = state.optOuts && state.optOuts[c.name];
      const last = entry && entry.lastSuccess ? entry.lastSuccess.slice(0, 10) : '-';
      console.log(pad(c.name, 40) + pad(c.state + (c.reviewedAt ? ` ${c.reviewedAt}` : ''), 28) + last);
    }
  }
  const { catalogEmailTargets } = require('./lib/catalog');
  const emailNames = [
    ...catalogEmailTargets(loadCatalog(), { explicitNames: new Set(brokers.map(b => b.name.toLowerCase())) }).map(t => t.name),
    ...brokers.filter(b => b.method === 'email').map(b => b.name),
  ];
  if (emailNames.length) {
    console.log(`\nEmail requests (${emailNames.length})`);
    console.log('-'.repeat(80));
    const { emailStatus } = require('./lib/email-step');
    for (const n of emailNames) {
      const { status, reply } = emailStatus(state, n);
      console.log(pad(n, 40) + pad(status, 18) + (reply || '-'));
    }
  }
  console.log('');
  process.exit(0);
}

// ── --reply <broker> <outcome>: log a reply to an email request, then exit ───
if (process.argv.includes('--reply')) {
  const i = process.argv.indexOf('--reply');
  const query = process.argv[i + 1] || '';
  const outcome = process.argv[i + 2] || '';
  const { recordReply, findEmailTarget, REPLY_OUTCOMES } = require('./lib/email-step');
  const { loadCatalog, catalogEmailTargets } = require('./lib/catalog');
  const brokersList = require('./brokers');
  if (!REPLY_OUTCOMES.includes(outcome)) {
    console.error(`Usage: upec-wipe reply <broker> ${REPLY_OUTCOMES.join('|')}`);
    process.exit(2);
  }
  const names = [
    ...catalogEmailTargets(loadCatalog(undefined, () => {}), { explicitNames: new Set(brokersList.map(b => b.name.toLowerCase())) }).map(t => t.name),
    ...brokersList.filter(b => b.method === 'email').map(b => b.name),
  ];
  const found = findEmailTarget(names, query);
  if (found.error) { console.error(found.error); process.exit(2); }
  const st = loadState();
  const keys = Object.keys(st.emailSent || {}).filter(k => k === found.name || k.startsWith(`${found.name}|`));
  for (const key of (keys.length ? keys : [found.name])) recordReply(st, key, outcome);
  saveState();
  console.log(`${found.name}: reply logged as ${outcome}.`);
  process.exit(0);
}

// ── --score: print the exposure score + breakdown + trend, then exit ─────────
// Read-only: no browser, no forms submitted. Reads state.json and the
// persisted SERP history; persists a dated snapshot to data/exposure-history.json.
if (SCORE_MODE) {
  const brokers = require('./brokers');
  const state   = loadState();
  const {
    computeExposureScore,
    serpResultsFromHistory,
    loadExposureHistory,
    snapshotExposure,
    formatScoreReport,
  } = require('./lib/exposure');

  // Reconstruct the SERP signal from persisted history (no live scan).
  let serpRows = [];
  const serpHistoryPath = path.join(__dirname, 'data', 'serp-history.json');
  try {
    serpRows = JSON.parse(fs.readFileSync(serpHistoryPath, 'utf8'));
    if (!Array.isArray(serpRows)) serpRows = [];
  } catch (_) { serpRows = []; }
  const serpResults = serpResultsFromHistory(serpRows);

  // breachCount defaults to 0 until HIBP integration lands.
  const summary = computeExposureScore({ state, serpResults, breachCount: 0, brokers });

  const priorHistory = loadExposureHistory();
  console.log('\n' + formatScoreReport(summary, priorHistory));
  // Persist this run's snapshot (skipped in dry-run to honor that contract).
  if (!DRY_RUN) snapshotExposure(summary);
  console.log('');
  process.exit(0);
}

// ── --pending: print brokers awaiting email confirmation, then exit ──────────
if (PENDING_MODE) {
  const brokers = require('./brokers');
  const { getPendingConfirmations } = require('./lib/config');
  const pending = getPendingConfirmations(brokers);
  if (pending.length === 0) {
    console.log('\nNo brokers are currently awaiting email confirmation.\n');
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log('\n' + pad('Broker', 40) + pad('Pending since', 14) + 'Confirmation hint');
    console.log('-'.repeat(90));
    for (const p of pending) {
      const since = p.since.slice(0, 10);
      const hint = p.expectedSender || (p.snippet ? p.snippet.slice(0, 40) : '(check your inbox)');
      console.log(pad(p.name, 40) + pad(since, 14) + hint);
    }
    console.log(`\n${pending.length} broker(s) awaiting confirmation. Check your inbox for opt-out confirmation emails.\n`);
  }
  process.exit(0);
}

// ── --allow / --unallow <name>: edit config.json allowlist, then exit ────────
const _allowlistCmd = parseAllowlistArgs(process.argv);
if (_allowlistCmd) {
  const { CONFIG_PATH, writeFileFsync } = require('./lib/config');
  if (_allowlistCmd.error || !_allowlistCmd.name) {
    console.error(`Error: ${_allowlistCmd.action === 'unallow' ? '--unallow' : '--allow'} requires a broker name, e.g. --${_allowlistCmd.action} Spokeo`);
    process.exit(1);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`Error: could not read config.json: ${configErrorReason(err)}`);
    process.exit(1);
  }
  const next = _allowlistCmd.action === 'allow'
    ? addToAllowlist(cfg, _allowlistCmd.name)
    : removeFromAllowlist(cfg, _allowlistCmd.name);
  // Atomic 0600 write: tmp (opened 0600) -> fsync -> rename -> chmod 0600.
  // config.json holds the legal name, address and every key (audit M2).
  writeFileFsync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n');
  const verb = _allowlistCmd.action === 'allow' ? 'Added to' : 'Removed from';
  console.log(`\n${verb} allowlist: ${_allowlistCmd.name}`);
  console.log(`   Allowlist now: ${(next.allowlist || []).join(', ') || '(empty)'}\n`);
  process.exit(0);
}

// -- --know-status: print right-to-know requests older than 45 days, then exit -
if (KNOW_STATUS) {
  const brokers = require('./brokers');
  const { getPendingKnowRequests } = require('./lib/config');
  const pending = getPendingKnowRequests(brokers, { olderThanDays: 45 });
  if (pending.length === 0) {
    console.log('\nNo right-to-know requests are older than 45 days awaiting a response.\n');
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log('\n' + pad('Broker', 40) + pad('Requested', 14) + 'Days ago');
    console.log('-'.repeat(70));
    for (const p of pending) {
      const when = p.knowRequestedAt.slice(0, 10);
      console.log(pad(p.name, 40) + pad(when, 14) + Math.round(p.daysAgo));
    }
    console.log(`\n${pending.length} right-to-know request(s) past 45 days. Follow up with the broker if no disclosure arrived.\n`);
  }
  process.exit(0);
}

// ── Mode-conflict guard ───────────────────────────────────────────────────────
// Detect mutually exclusive mode flags being combined (e.g. --doctor --report).
// Each documented mode exits after doing its work; combining them is ambiguous.
{
  const { resolveMode } = require('./lib/mode-dispatch');
  const { conflict } = resolveMode({
    list:             LIST_MODE,
    score:            SCORE_MODE,
    report:           REPORT,
    doctor:           DOCTOR,
    breachCheck:      BREACH_CHECK,
    updateBrokers:    UPDATE_BROKERS,
    pending:          PENDING_MODE,
    know:             KNOW_MODE,
    knowStatus:       KNOW_STATUS,
    complaints:       COMPLAINTS_MODE,
    confirmEmails:    CONFIRM_EMAILS,
    serpScan:         SERP_SCAN,
    serpWatch:        SERP_WATCH,
    encryptConfig:    ENCRYPT_CONFIG,
    decryptConfig:    DECRYPT_CONFIG,
    freeze:           FREEZE_MODE,
  });
  if (conflict) {
    console.error(`Error: ${conflict}`);
    process.exit(1);
  }
}

// ── --breach-check: query Have I Been Pwned for configured emails, then exit ─
if (BREACH_CHECK) {
  const brokers = require('./brokers');
  const {
    collectEmails,
    missingKeyMessage,
    runBreachCheck,
    formatBreachReport,
    confirmBreachCheck,
  } = require('./lib/hibp');

  const cfg     = loadConfig();
  setEgressConfig(cfg);
  const persons = getPersonsFromConfig(cfg);
  const emails  = collectEmails(persons);
  const apiKey  = cfg.hibp && cfg.hibp.apiKey;

  if (!apiKey) {
    console.log('\n' + missingKeyMessage() + '\n');
    process.exit(0);
  }

  if (emails.length === 0) {
    console.log('\nNo email addresses found in config.json. Add an "email" to your person(s) first.\n');
    process.exit(0);
  }

  (async () => {
    const ok = await confirmBreachCheck({ emails, isTTY: !!process.stdin.isTTY, ask: askLine, log: (l) => console.log(l) });
    if (!ok) process.exit(1);
    console.log(`\nChecking ${emails.length} email(s) against Have I Been Pwned...`);
    const result = await runBreachCheck({ emails, apiKey, brokers, config: cfg });
    console.log('\n' + formatBreachReport(result) + '\n');
    process.exit(0);
  })().catch(err => {
    console.error('breach-check error:', err.message);
    process.exit(1);
  });
} else {

// ── --complaints: generate regulator complaints for brokers past the legal
//    response window (CCPA 45d / GDPR 30d) and write text + PDF to logs/. ─────
if (COMPLAINTS_MODE) {
  const brokers = require('./brokers');
  const { findOverdue, buildComplaintsForBroker, writeComplaintFiles } = require('./lib/complaint');

  const config  = loadConfig();
  const state   = loadState();
  const persons = getPersonsFromConfig(config);
  const brokerMap = new Map(brokers.map(b => [b.name, b]));
  // Resolve the complaint's complainant back to the person named in the
  // composite state key (B2); fall back to the first person for bare keys.
  const personByName = new Map(
    persons
      .filter(p => p && (p.firstName || p.lastName))
      .map(p => [`${p.firstName || ''} ${p.lastName || ''}`.trim(), p])
  );

  const overdueList = findOverdue(state, { persons });
  if (overdueList.length === 0) {
    console.log('\nNo brokers are past their legal response window. Nothing to escalate.\n');
    process.exit(0);
  }

  const outDir = path.join(__dirname, 'logs', 'complaints');
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('Broker', 32) + pad('Regime', 8) + pad('Days overdue', 14) + 'Requested');
  console.log('-'.repeat(78));

  const entries = overdueList.map(overdue => {
    const broker = brokerMap.get(overdue.broker) || { name: overdue.broker };
    const person = (overdue.person && personByName.get(overdue.person)) || persons[0];
    console.log(
      pad(overdue.broker, 32) +
      pad(overdue.regime, 8) +
      pad(String(overdue.daysOverdue), 14) +
      String(overdue.requestedAt).slice(0, 10)
    );
    return { broker: overdue.broker, complaints: buildComplaintsForBroker({ person, broker, overdue }) };
  });

  (async () => {
    let newPage;
    let context;
    let session = null;
    if (!DRY_RUN) {
      let chromiumForPdf;
      chromiumForPdf = loadChromium();
      session = await openBrowserSession({ chromium: chromiumForPdf, config, headless: true, needsNetwork: false });
      context = session.context;
      newPage = () => context.newPage();
    } else {
      console.log('\nDRY RUN - writing complaint text only, skipping PDF generation.');
    }

    try {
      const { written } = await writeComplaintFiles({ outDir, entries, newPage });
      console.log(`\nWrote ${written.length} complaint file(s) to ${outDir}`);
      const pdfCount = written.filter(p => p.endsWith('.pdf')).length;
      const txtCount = written.filter(p => p.endsWith('.txt')).length;
      console.log(`   ${txtCount} text, ${pdfCount} PDF\n`);
    } finally {
      if (session) await session.close();
    }
    process.exit(0);
  })().catch(err => {
    console.error('complaints error:', err.message);
    process.exit(1);
  });
} else

// ── --confirm-emails [dir]: process .eml files and auto-click confirm links ───
if (CONFIRM_EMAILS) {
  const brokers = require('./brokers');
  const { processConfirmationEmails, describeConfirmOutcome, summarizeConfirmResult } = require('./lib/imap-confirm');

  // Launch a minimal headless browser context just for navigating confirm links
  let chromiumForConfirm;
  chromiumForConfirm = loadChromium();

  // Acquire the same process lock as main() - processConfirmationEmails calls
  // recordSuccess -> saveState, so it must not race a concurrent normal run.
  const CONFIRM_LOCK_PATH = STATE_PATH + '.lock';
  try {
    lock.acquire(CONFIRM_LOCK_PATH);
  } catch (err) {
    const pidMatch = err.message.match(/pid (\d+)/);
    console.error(`Another instance is running, pid=${pidMatch ? pidMatch[1] : '?'}. Exiting.`);
    process.exit(1);
  }

  // Ctrl+C / SIGTERM: close the browser (deletes the throwaway profile) and
  // release the lock before exiting 130/143.
  let confirmClose = null;
  let confirmProfile = null; // set as soon as the profile dir exists, before launch
  installSignalCleanup({
    cleanup: async () => {
      if (confirmClose) await confirmClose();
      else if (confirmProfile) confirmProfile.cleanup();
      lock.release(CONFIRM_LOCK_PATH);
    },
    syncCleanup: () => {
      if (confirmProfile) confirmProfile.cleanup();
      try { lock.release(CONFIRM_LOCK_PATH); } catch (_) { /* best effort */ }
    },
  });

  (async () => {
    console.log(`\nProcessing confirmation emails from: ${confirmEmailsDir}`);
    const { context, close } = await openBrowserSession({ chromium: chromiumForConfirm, config: loadConfig(), headless: true, onProfile: (p) => { confirmProfile = p; } });
    confirmClose = close;

    try {
      const result = await processConfirmationEmails(context, brokers, {
        dir: confirmEmailsDir,
        dryRun: DRY_RUN,
      });

      for (const entry of result.processed) {
        console.log(`  ${describeConfirmOutcome(entry)}: ${entry.broker.name}`);
      }
      for (const entry of result.unmatched) {
        console.log(`  unmatched (${entry.reason}): ${entry.file}`);
      }
      for (const entry of result.failed) {
        console.log(`  failed: ${entry.broker.name} -> ${entry.error}`);
      }

      console.log(`\n${summarizeConfirmResult(result)}\n`);
    } finally {
      await close();
      lock.release(CONFIRM_LOCK_PATH);
    }
    process.exit(0);
  })().catch(err => {
    lock.release(CONFIRM_LOCK_PATH);
    console.error('confirm-emails error:', err.message);
    process.exit(1);
  });
} else if (REPORT) {

// ── --report: build monthly PDF + emailable HTML report and exit ─────────────
const brokers = require('./brokers');
const { buildReportModel, renderReportHtml, renderReportPdf, reportPdfPath, REPORT_DIR } = require('./lib/report');
const {
  computeExposureScore,
  serpResultsFromHistory,
  loadExposureHistory,
  exposureToReportAdapter,
} = require('./lib/exposure');

let chromiumForReport;
chromiumForReport = loadChromium();

const reportConfig = loadConfig();

const REPORT_LOCK_PATH = STATE_PATH + '.lock';
try {
  lock.acquire(REPORT_LOCK_PATH);
} catch (err) {
  const pidMatch = err.message.match(/pid (\d+)/);
  console.error(`Another instance is running, pid=${pidMatch ? pidMatch[1] : '?'}. Exiting.`);
  process.exit(1);
}

(async () => {
  const state = loadState();

  // Compute current exposure so the report can show a real trend.
  let serpRowsForReport = [];
  try {
    const serpHistoryPathForReport = path.join(__dirname, 'data', 'serp-history.json');
    serpRowsForReport = JSON.parse(fs.readFileSync(serpHistoryPathForReport, 'utf8'));
    if (!Array.isArray(serpRowsForReport)) serpRowsForReport = [];
  } catch (_) { serpRowsForReport = []; }
  const serpResultsForReport = serpResultsFromHistory(serpRowsForReport);
  const exposureSummary = computeExposureScore({ state, serpResults: serpResultsForReport, breachCount: 0, brokers });
  const priorHistory = loadExposureHistory();
  const exposure = exposureToReportAdapter(exposureSummary, priorHistory);

  const model = buildReportModel({ state, brokers, exposure });
  const html = renderReportHtml(model);

  fs.mkdirSync(REPORT_DIR, { recursive: true, mode: 0o700 });
  const outPath = reportPdfPath(new Date());

  const { context, close: closeReportSession } = await openBrowserSession({ chromium: chromiumForReport, config: reportConfig, headless: true, needsNetwork: false });

  try {
    await renderReportPdf({ html, outPath, context });
    console.log(`\nReport PDF written: ${outPath}`);

    console.log(`Report saved. Actions needed: ${model.actionsNeeded.length}`);
  } finally {
    await closeReportSession();
    lock.release(REPORT_LOCK_PATH);
  }
  process.exit(0);
})().catch(err => {
  lock.release(REPORT_LOCK_PATH);
  console.error('report error:', err.message);
  process.exit(1);
});

} else {

// ── --doctor: self-diagnose and exit ─────────────────────────────────────────
if (DOCTOR) {
  const { runDoctor } = require('./lib/doctor');
  runDoctor().then(results => {
    process.exit(results.exitCode);
  }).catch(err => {
    console.error('doctor error:', err.message);
    process.exit(1);
  });
} else if (UPDATE_BROKERS) {
  // ── --update-brokers: refresh data/feeds-brokers.json from live registries ──
  // Pure HTTP + file write; no Playwright, no loadConfig. Fetches the California
  // + Vermont data-broker registries, normalizes, dedups against brokers.js, and
  // writes the feed file consumed by generic-runner.js. Markup data remains the
  // fallback. Async, so this lives as a peer of --doctor (not a standalone
  // pre-ladder block) to avoid falling through into the normal Playwright run.
  const brokers = require('./brokers');
  const { runUpdateBrokers } = require('./lib/feeds');
  // The egress gate needs network.required / network.proxy. With no readable
  // config it falls back to {} and requires Mullvad (fail closed).
  let updateCfg = {};
  try {
    const { CONFIG_PATH, CONFIG_ENC_PATH } = require('./lib/config');
    if (fs.existsSync(CONFIG_PATH) || fs.existsSync(CONFIG_ENC_PATH)) updateCfg = loadConfig();
  } catch (err) {
    // Say so: network.required / network.proxy from the config do not apply.
    const reason = configErrorReason(err);
    console.warn(`Warning: config could not be read (${reason}); using network defaults (Mullvad check required).`);
    updateCfg = {};
  }
  setEgressConfig(updateCfg);
  runUpdateBrokers({ brokers, logFn: (m) => console.log(m), config: updateCfg })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('update-brokers error:', err.message);
      process.exit(1);
    });
} else {

setDryRun(DRY_RUN); // makes recordSuccess/saveState no-op-on-disk in dry-run

const config = loadConfig();
setEgressConfig(config);
if (config.notify) console.log('ℹ  notify settings in config.json are ignored in this fork.');
const state = loadState();
const persons = getPersonsFromConfig(config);

// -- --know: fire right-to-know (data access) requests to email brokers, exit --
// No browser needed - email-method brokers only. Acquires the state lock since
// recordKnowRequest -> saveState writes state.json.
if (KNOW_MODE) {
  const brokers = require('./brokers');
  const { runKnowStep } = require('./lib/right-to-know-runner');
  const { getPendingKnowRequests } = require('./lib/config');
  const KNOW_LOCK_PATH = STATE_PATH + '.lock';
  try {
    lock.acquire(KNOW_LOCK_PATH);
  } catch (err) {
    const pidMatch = err.message.match(/pid (\d+)/);
    console.error(`Another instance is running, pid=${pidMatch ? pidMatch[1] : '?'}. Exiting.`);
    process.exit(1);
  }

  (async () => {
    const plan = await buildSubmissionPlan({ config, persons, state, preview: DRY_RUN });
    for (const b of plan.blocked) {
      console.error(`Skipping person #${persons.indexOf(b.person) + 1}: ${b.reason}`);
    }
    if (plan.allowed.some(a => a.placeholder)) console.log(PREVIEW_ALIAS_NOTE);
    const code = await runKnowStep({
      config, persons, state, save: saveState, brokers, preview: DRY_RUN,
      ...submissionOptions(plan), ...emailStepIo(),
    });
    // Keeps an alias minted by buildSubmissionPlan even when nothing was sent.
    saveState();
    const pending = getPendingKnowRequests(brokers, { olderThanDays: 45 });
    console.log(`\n${pending.length} earlier request(s) are past 45 days (run --know-status for detail).\n`);
    return code;
  })().then((code) => {
    lock.release(KNOW_LOCK_PATH);
    process.exit(code);
  }).catch(err => {
    lock.release(KNOW_LOCK_PATH);
    console.error('know error:', err.message);
    process.exit(1);
  });
} else {

brokerRunner.configure({ dryRun: DRY_RUN, preview: PREVIEW, assist: ASSIST, person: persons[0], capsolver: config.capsolver, noCapsolver: NO_CAPSOLVER, snapshot: SNAPSHOT, personCount: persons.length, config });

// Detect brokers that have been consistently unreachable across recent runs.
// Defunct brokers still run - the warning is informational so the user can
// prune stale entries from brokers.js if the site is truly gone.
const defunctNames = findDefunct(state.optOuts || {});
if (defunctNames.length > 0) {
  setDefunctBrokers(defunctNames);
  console.log(`\n${defunctNames.length} broker(s) flagged as defunct (${DEFUNCT_THRESHOLD}+ consecutive unreachable errors):`);
  console.log(`   ${defunctNames.join(', ')}`);
  console.log('   These will still run. Remove from brokers.js if site is gone.\n');
}

// Project-local Playwright only (audit L6: no home-dir fallback)
let chromium;
chromium = loadChromium();

const isMac = process.platform === 'darwin';

if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = isMac
    ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
    : path.join(os.homedir(), '.cache', 'ms-playwright');
}

const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
// Timestamped to the second (B8): two runs on the same day must not overwrite
// each other, otherwise loadPreviousLog/diffResults can never diff intraday runs.
const logFile = path.join(LOG_DIR, `run-${timestampForFilename(new Date().toISOString())}.json`);
const stamp = () => new Date().toLocaleTimeString();

const LOCK_PATH = STATE_PATH + '.lock';
// Brokers between browser egress re-checks (about 2-3 minutes with jitter).
const EGRESS_RECHECK_EVERY = 10;

// Set by _mainBody once the browser opens; main()'s finally closes it so the
// throwaway profile is deleted even when the run throws.
let mainSession = null;
let mainProfile = null; // throwaway profile, known before the browser finishes launching

async function main() {
  // Acquire process lock to prevent concurrent runs racing on state.json
  try {
    lock.acquire(LOCK_PATH);
  } catch (err) {
    const pidMatch = err.message.match(/pid (\d+)/);
    const pid = pidMatch ? pidMatch[1] : '?';
    console.error(`Another instance is running, pid=${pid}. Exiting.`);
    process.exit(1);
  }

  // Ctrl+C / SIGTERM mid-run: close the session (deletes the throwaway
  // profile) and release the lock before exiting 130/143.
  installSignalCleanup({
    cleanup: async () => {
      if (mainSession) await mainSession.close();
      else if (mainProfile) mainProfile.cleanup();
      lock.release(LOCK_PATH);
    },
    syncCleanup: () => {
      if (mainProfile) mainProfile.cleanup();
      try { lock.release(LOCK_PATH); } catch (_) { /* best effort */ }
    },
  });

  try {
    return await _mainBody();
  } finally {
    if (mainSession) await mainSession.close();
    lock.release(LOCK_PATH);
  }
}

async function _mainBody() {
  const brokers = require('./brokers');
  const { loadCatalog, catalogBrokersForPerson, catalogDomains } = require('./lib/catalog');
  const { explicitHostsOf } = require('./lib/feeds');
  // Reviewed sites from data/catalog/ run after the 32, through the same
  // processBroker path. A bad record is skipped with a warning by the loader.
  const catalogRecords = loadCatalog();
  const explicitCatalogOpts = {
    explicitHosts: explicitHostsOf(brokers),
    explicitNames: new Set(brokers.map(b => b.name.toLowerCase())),
  };
  if (EMAIL) {
    const { runEmailStep } = require('./lib/email-step');
    const { catalogEmailTargets } = require('./lib/catalog');
    let code;
    try {
      code = await runEmailStep({
        config, persons, state, save: saveState,
        targets: catalogEmailTargets(catalogRecords, { explicitNames: explicitCatalogOpts.explicitNames }),
        brokers, preview: DRY_RUN, ...emailStepIo(),
      });
    } catch (err) {
      // Off the VPN: nothing was sent (the gate runs before the transport).
      if (!(err instanceof EgressError)) throw err;
      console.error(`${err.message}`);
      code = 1;
    }
    if (code) process.exitCode = code;
    if (!FORMS) return;
  }
  const { runGenericBrokers } = require('./generic-runner');

  console.log('\nUPEC-WIPE - starting run');
  if (PREVIEW)       console.log('PREVIEW - field values and target URLs will be printed before submit. No state will be saved.');
  if (ASSIST)        console.log('ASSIST - when a site shows a bot check, the run waits for you to complete it in the browser window (up to 3 min each).');
  else if (DRY_RUN)  console.log('DRY RUN - forms will be filled but NOT submitted. No state will be saved.');
  if (VERIFY)        console.log('VERIFY - re-checking listings. No forms submitted. Verification results are saved.');
  console.log(`Started: ${new Date().toLocaleString()}`);
  const GENERIC_ENABLED = isGenericEnabled(process.argv, config);
  console.log(`${brokers.length} explicit brokers${GENERIC_ENABLED ? ' + 500+ generic' : ' (generic pass off - pass --generic to enable)'} | re-check window: ${RECHECK_DAYS} days\n`);

  // Headless mode: respect HEADLESS env var, else auto-detect.
  // Default to false (headed) on platforms where a display is likely present.
  // In Docker (no $DISPLAY on linux), default to headless: true so the tool actually runs.
  const headlessEnv = process.env.HEADLESS;
  const headless = resolveHeadless();
  console.log(`Browser mode: ${headless ? 'headless' : 'headed'}${headlessEnv === undefined && process.platform === 'linux' ? ' (auto-detected)' : ''}${isLowMemory() ? ' [low-memory profile]' : ''}`);

  let session;
  try {
    session = await openBrowserSession({ chromium, config, headless, onProfile: (p) => { mainProfile = p; } });
  } catch (err) {
    if (err instanceof EgressError) { console.error(`${err.message}`); process.exitCode = 1; return; }
    throw err;
  }
  mainSession = session;
  const context = session.context;
  await context.addInitScript(buildStealthScript());

  // ── Verify mode: T+7 post-submit verification loop ───────────────────────
  if (VERIFY) {
    const { runVerify } = require('./lib/verify-loop');
    const result = await runVerify(context, brokers, persons, { state, config });
    saveState();
    await session.close();

    // Print summary
    console.log('\n' + '='.repeat(54));
    console.log('Verification results - ' + new Date().toLocaleString());
    console.log('='.repeat(54));
    console.log(`  verified_clear : ${result.verified_clear.length}`);
    console.log(`  still_listed   : ${result.still_listed.length}`);
    console.log(`  unverifiable   : ${result.unverifiable.length}`);
    console.log(`  skipped        : ${result.skipped.length}`);
    if (result.still_listed.length > 0) {
      console.log('\nStill listed (opt-out may have failed or data was re-added):');
      for (const e of result.still_listed) {
        const name = e.person ? `${e.person.firstName} ${e.person.lastName}` : '';
        console.log(`  - ${e.broker}${name ? ` (${name})` : ''}`);
      }
    }
    console.log('='.repeat(54) + '\n');
    return;
  }

  // ── SERP scan mode: search-engine broker visibility audit ────────────────
  if (SERP_SCAN) {
    const { runSerpScan } = require('./lib/serp-scan');
    console.log('\nSERP scan - checking broker visibility in search engines');
    console.log('   DDG first, then Bing, then Google (may be blocked).\n');
    const summary = await runSerpScan(context, persons, brokers);
    await session.close();

    const pad = (s, n) => String(s).padEnd(n);
    console.log('\n' + '='.repeat(62));
    console.log('SERP Scan Results - ' + new Date().toLocaleString());
    console.log('='.repeat(62));

    if (summary.blocked.length > 0) {
      console.log(`\n  Blocked engines (bot-detection triggered): ${summary.blocked.join(', ')}`);
    }

    console.log(`\n  Brokers appearing in search results: ${summary.total_brokers_appearing}`);

    if (summary.total_brokers_appearing > 0) {
      console.log('');
      console.log(
        '  ' + pad('Broker', 32) + pad('DDG', 8) + pad('Bing', 8) + 'Google'
      );
      console.log('  ' + '-'.repeat(56));
      for (const { broker, ranks } of summary.results) {
        const r = n => (n === null ? '-' : String(n));
        console.log(
          '  ' + pad(broker, 32) + pad(r(ranks.ddg), 8) + pad(r(ranks.bing), 8) + r(ranks.google)
        );
      }
    } else {
      console.log('\n  No broker domains found in the top search results.');
      console.log('  Your opt-outs appear to be effective at the SERP level.');
    }

    console.log('\n' + '='.repeat(62) + '\n');
    return;
  }

  // -- SERP watch mode: scan + diff vs history, list NEW domains ---------
  if (SERP_WATCH) {
    const { runSerpWatch } = require('./lib/serp-watch');
    console.log('\n SERP watch - scanning, then diffing against previous history');
    console.log('   New domains are printed below and recorded in data/serp-history.json.\n');
    const watch = await runSerpWatch(context, persons, brokers, { cfg: config });
    await session.close();

    console.log('\n' + '='.repeat(62));
    console.log('SERP Watch Results - ' + new Date().toLocaleString());
    console.log('='.repeat(62));
    if (watch.summary.blocked.length > 0) {
      console.log(`\n  Blocked engines (bot-detection triggered): ${watch.summary.blocked.join(', ')}`);
    }
    console.log(`\n  New domains    : ${watch.diff.newDomains.length}`);
    console.log(`  Gone domains   : ${watch.diff.goneDomains.length}`);
    console.log(`  Still present  : ${watch.diff.stillPresent.length}`);
    if (watch.diff.newDomains.length > 0) {
      console.log('\n  WARNING: NEW domains your name now appears on:');
      for (const d of watch.diff.newDomains) console.log(`     - ${d}`);
    } else {
      console.log('\n  No new broker domains since the last scan.');
    }
    console.log('\n' + '='.repeat(62) + '\n');
    return;
  }

  // ── Resolve --retry-failed broker set ──────────────────────────────────────
  let retryFailedFromLog;
  if (RETRY_FAILED) {
    const log = loadLastLog(LOG_DIR);
    if (!log) {
      console.log('Warning: --retry-failed: no previous log found in logs/ - running all brokers.');
    } else {
      retryFailedFromLog = extractFailedBrokers(log);
      console.log(`--retry-failed: ${retryFailedFromLog.size} broker(s) from last log`);
    }
  }

  // Resolve every person's submission email up front (fork: fail closed). A
  // person whose relay alias is unavailable gets no submissions on any channel.
  let plan;
  try {
    plan = await buildSubmissionPlan({ config, persons, state, preview: DRY_RUN });
  } catch (err) {
    if (!(err instanceof EgressError)) throw err;
    console.error(`${err.message}`);
    await session.close();
    process.exitCode = 1;
    return;
  }
  for (const b of plan.blocked) {
    console.error(`Skipping person #${persons.indexOf(b.person) + 1}: ${b.reason}`);
  }
  if (plan.allowed.some(a => a.placeholder)) console.log(PREVIEW_ALIAS_NOTE);
  if (plan.allowed.length === 0) {
    console.error('No person has a usable submission email. Nothing submitted.');
    saveState();
    await session.close();
    process.exitCode = 1;
    return;
  }


  for (const { person, email: submissionEmail, masked } of plan.allowed) {
    if (persons.length > 1) {
      console.log(`\n${'='.repeat(54)}`);
      console.log(`Running for: ${person.firstName} ${person.lastName}`);
      console.log('='.repeat(54));
    }
    if (masked) console.log(`   Using masked email for submissions: ${submissionEmail}`);
    else console.log('   Warning: relay.required is false: brokers will receive your real email.');

    brokerRunner.configure({ dryRun: DRY_RUN, preview: PREVIEW, assist: ASSIST, person, capsolver: config.capsolver, noCapsolver: NO_CAPSOLVER, snapshot: SNAPSHOT, personCount: persons.length, config, submissionEmail });

    // Rebuild the broker list for THIS person. brokers.js interpolates names,
    // city, state, zip and email into searchUrl and formFields, so reusing the
    // module-level array would submit persons[0]'s PII on every iteration.
    const personBrokers = [
      ...brokers.forPerson(person),
      ...catalogBrokersForPerson(catalogRecords, person, explicitCatalogOpts),
    ];

    const filterOpts = {
      only:             ONLY_ARG,
      skip:             SKIP_ARG,
      retryFailedFromLog,
    };

    let sorted = applyFilter(
      [...personBrokers]
        .filter(b => b.method !== 'email')
        .sort((a, b) => (a.priority || 9) - (b.priority || 9)),
      filterOpts
    );

    if (RESUME) {
      const ckpt = loadCheckpoint();
      if (ckpt) {
        // Match via stateKey (B22): the checkpoint stores the composite
        // "Broker|First Last" key in multi-person mode, so a bare-name compare
        // would miss and silently re-run everything.
        const ckptIdx = findResumeIndex(sorted, ckpt, person, persons.length);
        if (ckptIdx > 0) {
          console.log(`\n--resume: skipping ${ckptIdx} broker(s) before "${ckpt}"`);
          sorted = sorted.slice(ckptIdx);
        } else if (ckptIdx === -1) {
          console.log(`\n--resume: checkpoint broker "${ckpt}" not found in list, running all`);
        }
      } else {
        console.log('\n--resume: no checkpoint found, running all brokers');
      }
    }

    if (ONLY_ARG || SKIP_ARG || RETRY_FAILED) {
      console.log(`Filter applied - ${sorted.length} broker(s) will run`);
    }

    console.log('\n── Explicit broker opt-outs ───────────────────────────────');
    let sinceCheck = 0;
    for (const broker of sorted) {
      if (!brokerRunner.appliesToPerson(broker, person)) continue;
      process.stdout.write(`\n[${stamp()}] ${broker.name}… `);
      try {
        if (++sinceCheck % EGRESS_RECHECK_EVERY === 0) await session.recheckEgress();
        await brokerRunner.processBroker(context, broker);
      } catch (err) {
        if (!(err instanceof EgressError)) throw err;
        console.error(`\n${err.message}`);
        saveState();
        await session.close();
        process.exitCode = 1;
        return;
      }
    }
  }

  // Build the set of explicit broker hostnames so generic-runner can skip them.
  const explicitHosts = new Set(
    brokers.map(b => {
      try {
        return new URL(b.optOutUrl || b.searchUrl || '').hostname.replace(/^www\./, '');
      } catch(_) { return ''; }
    }).filter(Boolean)
  );
  for (const d of catalogDomains(catalogRecords)) explicitHosts.add(d);

  // One generic pass PER PERSON.
  //
  // This used to run once, using persons[0], with state keyed on the bare broker
  // name. But fillGenericForm() submits a real name, email, state and zip - so
  // "generic" is not person-agnostic for the brokers that take a form. The old
  // shape meant only persons[0] was ever requested while the single state entry
  // marked the broker done for the whole household, and the report claimed
  // everyone had been opted out.
  //
  // The cost is real and worth naming: an N-person run now does the ~490-broker
  // generic pass N times, so wall-clock scales with N. Correct coverage beats a
  // faster run that quietly skips people. Domain-level toggles (cookie /
  // "Do Not Sell") get re-applied per person, which is harmless.
  const genericTotals = {};
  if (GENERIC_ENABLED) {
    for (const { person, email } of plan.allowed) {
      if (persons.length > 1) {
        console.log(`\n── Generic brokers for ${person.firstName} ${person.lastName} ──`);
      }
      // getFieldMap() fills email fields from person.email, so hand it the
      // alias-bearing copy. stateKey() keys on names, so state is unaffected.
      const genericResult = await runGenericBrokers(context, explicitHosts, state, logResult, recordSuccess, {
        dryRun: DRY_RUN,
        person: withSubmissionEmail(person, email),
        personCount: persons.length,
        recheckEgress: session.recheckEgress,
      });
      if (genericResult && genericResult.genericStats) {
        for (const [k, v] of Object.entries(genericResult.genericStats)) {
          genericTotals[k] = (genericTotals[k] || 0) + (typeof v === 'number' ? v : 0);
        }
      }
    }
  } else {
    console.log('\n── Generic brokers: off (fork default; --generic or generic.enabled to opt in) ──');
  }
  results.genericStats = genericTotals;

  // Clear checkpoint now that the run completed successfully
  clearCheckpoint();

  await session.close();

  // Save run log (skipped in dry-run)
  if (!DRY_RUN) fs.writeFileSync(logFile, JSON.stringify(results, null, 2));

  // Diff against previous run + write audit markdown (skipped in dry-run)
  if (!DRY_RUN) {
    const prevLog = loadPreviousLog(LOG_DIR, logFile);
    const diff = diffResults(prevLog, results);
    console.log(`\n${diff.summary}`);

    const auditMd = renderAuditMarkdown({
      person: persons[0],
      timestamp: results.runAt,
      results,
    });
    const auditPath = writeAuditFile(LOG_DIR, auditMd, results.runAt);
    console.log(`Audit: ${auditPath}`);
  }

  // Open manual-required sites
  const manualUrls = [...results.captchaFailed, ...results.manual]
    .map(r => r.detail || '')
    .filter(u => u.startsWith('http'));
  // A dry run opens nothing: the everyday browser does not use network.proxy.
  if (manualUrls.length > 0 && !DRY_RUN) {
    console.log(`\nOpening ${manualUrls.length} manual site(s) in browser…`);
    openInBrowser(manualUrls);
  } else if (manualUrls.length > 0) {
    console.log(`\n${manualUrls.length} manual site(s) would open in your browser on a real run.`);
  }

  // Print summary
  const summary = buildSummary();
  console.log('\n' + '═'.repeat(54));
  console.log(summary);
  console.log('═'.repeat(54));
  if (DRY_RUN) {
    console.log(`\nLog: none - a ${PREVIEW ? 'preview' : 'dry run'} writes no log and saves no state. The summary above is the whole result.\n`);
  } else {
    console.log(`\nLog: ${logFile}`);
    console.log(`State: ${STATE_PATH}\n`);
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});

} // end else (not --know mode)

} // end else (not DOCTOR mode)

} // end else (not --confirm-emails mode)

} // end else (not --breach-check mode)
