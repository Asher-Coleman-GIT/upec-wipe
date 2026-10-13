'use strict';
/**
 * lib/modes/run.js - the opt-out run: web forms, and with --email the email
 * requests (moved from watcher.js).
 */
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const ROOT = path.join(__dirname, '..', '..');

const { STATE_PATH, RECHECK_DAYS, saveState, recordSuccess, loadCheckpoint, clearCheckpoint, findResumeIndex } = require('../config');
const { loadChromium } = require('../playwright-loader');
const { results, logResult, buildSummary, setDefunctBrokers } = require('../logger');
const { findDefunct, DEFUNCT_THRESHOLD } = require('../defunct');
const { openInBrowser } = require('../notify');
const brokerRunner = require('../broker-runner');
const { genericRetiredMessage, buildSubmissionPlan } = require('../submission-plan');
const lock = require('../lock');
const { applyFilter, loadLastLog, extractFailedBrokers } = require('../filter');
const { diffResults, loadPreviousLog } = require('../diff');
const { renderAuditMarkdown, writeAuditFile, timestampForFilename } = require('../audit');
const { buildStealthScript } = require('../stealth');
const { resolveHeadless, isLowMemory } = require('../browser');
const { openBrowserSession, EgressError } = require('../browser-session');
const { installSignalCleanup } = require('../shutdown');
const { renderBanner, useColor } = require('../banner');
const { PREVIEW_ALIAS_NOTE, acquireStateLockOrExit, emailStepIo, loadRunSetup } = require('./shared');

// Brokers between browser egress re-checks (about 2-3 minutes with jitter).
const EGRESS_RECHECK_EVERY = 10;

// Calls recheck before every Nth broker. One counter serves all persons, so a
// person boundary never resets the count.
function makeEgressCounter(recheck, every = EGRESS_RECHECK_EVERY) {
  let n = 0;
  return async () => {
    if (++n % every === 0) await recheck();
  };
}

async function run({ flags, argv }) {
  const { DRY_RUN, PREVIEW, ASSIST, NO_CAPSOLVER, EMAIL, FORMS, VERIFY, SERP_WATCH, RETRY_FAILED, ONLY_ARG, SKIP_ARG, RESUME } = flags;
  const { config, state, persons } = loadRunSetup(flags);
  const retired = genericRetiredMessage(config);
  if (retired) {
    console.error(retired);
    return 1;
  }

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

  const LOG_DIR = path.join(ROOT, 'logs');
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  // Timestamped to the second (B8): two runs on the same day must not overwrite
  // each other, otherwise loadPreviousLog/diffResults can never diff intraday runs.
  const logFile = path.join(LOG_DIR, `run-${timestampForFilename(new Date().toISOString())}.json`);
  const stamp = () => new Date().toLocaleTimeString();

  const LOCK_PATH = STATE_PATH + '.lock';

  // Set by _mainBody once the browser opens; main()'s finally closes it so the
  // throwaway profile is deleted even when the run throws.
  let mainSession = null;
  let mainProfile = null; // throwaway profile, known before the browser finishes launching

  async function main() {
    // Acquire process lock to prevent concurrent runs racing on state.json
    acquireStateLockOrExit();

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
    const brokers = require('../../brokers');
    const { loadCatalog, catalogBrokersForPerson, catalogFormSiteCount } = require('../catalog');
    const { explicitHostsOf } = require('../feeds');
    // Reviewed sites from data/catalog/ run after the 32, through the same
    // processBroker path. A bad record is skipped with a warning by the loader.
    const catalogRecords = loadCatalog();
    const explicitCatalogOpts = {
      explicitHosts: explicitHostsOf(brokers),
      explicitNames: new Set(brokers.map(b => b.name.toLowerCase())),
    };
    if (EMAIL) {
      const { runEmailStep } = require('../email-step');
      const { catalogEmailTargets } = require('../catalog');
      let code;
      try {
        code = await runEmailStep({
          config, persons, state, save: saveState,
          targets: catalogEmailTargets(catalogRecords, { explicitNames: explicitCatalogOpts.explicitNames }),
          brokers, preview: DRY_RUN, only: ONLY_ARG, skip: SKIP_ARG, ...emailStepIo(),
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
    if (process.stdout.isTTY) console.log(renderBanner({ color: useColor() }));
    console.log('\nUPEC-WIPE - starting run');
    if (PREVIEW)       console.log('PREVIEW - field values and target URLs will be printed before submit. No state will be saved.');
    if (ASSIST)        console.log('ASSIST - when a site shows a bot check, the run waits for you to complete it in the browser window (up to 3 min each).');
    else if (DRY_RUN)  console.log('DRY RUN - forms will be filled but NOT submitted. No state will be saved.');
    if (VERIFY)        console.log('VERIFY - re-checking listings. No forms submitted. Verification results are saved.');
    console.log(`Started: ${new Date().toLocaleString()}`);
    console.log(`${brokers.length} explicit brokers + ${catalogFormSiteCount(catalogRecords)} catalog sites | re-check window: ${RECHECK_DAYS} days\n`);

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
      const { runVerify } = require('../verify-loop');
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

    // -- SERP watch mode: scan + diff vs history, list NEW domains ---------
    if (SERP_WATCH) {
      const { runSerpWatch } = require('../serp-watch');
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


    const beforeBroker = makeEgressCounter(() => session.recheckEgress());
    for (const { person, email: submissionEmail, masked } of plan.allowed) {
      if (persons.length > 1) {
        console.log(`\n${'='.repeat(54)}`);
        console.log(`Running for: ${person.firstName} ${person.lastName}`);
        console.log('='.repeat(54));
      }
      if (masked) console.log(`   Using masked email for submissions: ${submissionEmail}`);
      else console.log('   Warning: relay.required is false: brokers will receive your real email.');

      const runner = brokerRunner.createBrokerRunner({ dryRun: DRY_RUN, preview: PREVIEW, assist: ASSIST, person, capsolver: config.capsolver, noCapsolver: NO_CAPSOLVER, personCount: persons.length, config, submissionEmail });

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
      for (const broker of sorted) {
        if (!runner.appliesToPerson(broker, person)) continue;
        process.stdout.write(`\n[${stamp()}] ${broker.name}… `);
        try {
          await beforeBroker();
          await runner.processBroker(context, broker);
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
    // A forms-only run says what the email step still has to send.
    if (!EMAIL) {
      const { emailReminder } = require('../email-step');
      const { catalogEmailTargets } = require('../catalog');
      const reminder = emailReminder({
        config, persons, state, brokers,
        targets: catalogEmailTargets(catalogRecords, { explicitNames: explicitCatalogOpts.explicitNames }),
      });
      if (reminder) console.log(`\n${reminder}`);
    }
    if (DRY_RUN) {
      console.log(`\nLog: none - a ${PREVIEW ? 'preview' : 'dry run'} writes no log and saves no state. The summary above is the whole result.\n`);
    } else {
      console.log(`\nLog: ${logFile}`);
      console.log(`State: ${STATE_PATH}\n`);
    }
  }

  return main();
}

module.exports = { run, makeEgressCounter, EGRESS_RECHECK_EVERY };
