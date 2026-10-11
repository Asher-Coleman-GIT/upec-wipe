/**
 * lib/broker-runner.js
 *
 * Per-broker processing (`processBroker`) and email opt-outs
 * (`sendEmailOptOuts`). Verbatim logic from the monolith.
 *
 * The original closed over module-level `DRY_RUN`, `person`, and `capsolver`.
 * Here those are injected once via `configure({ dryRun, person, capsolver })`
 * before the run starts - preserving singleton semantics with no circular
 * requires (this module imports config/logger/forms/captcha; none import back).
 */

const { recordSuccess, recordPendingConfirmation, recordFailure, shouldSkip, saveCheckpoint, stateKey } = require('./config');
const { logResult } = require('./logger');
const { fillForm, findListingUrl } = require('./forms');
const { isAllowlisted } = require('./filter');
const { detectAndSolveCaptcha } = require('./captcha');
const { EgressError } = require('./egress');
const { detectConfirmationRequired } = require('./confirm');
const { classifyPostSubmit } = require('./success');
const { redactUrlsInText } = require('./redact');
const { langOf } = require('./locale-patterns');
const { withRetry } = require('./retry');
const { jitterSleep } = require('./timing');
const { captureSubmitSnapshot } = require('./snapshot');
const { checkPageBlockedDetail, BlockedPageError } = require('./block-page');
const { waitForHumanCheck } = require('./assist');
const { normalizeUsState } = require('./us-state');

let opts = { dryRun: false, person: null, capsolver: null, noCapsolver: false, snapshot: false, personCount: 1, config: null, submissionEmail: null };

function configure(o) {
  opts = { ...opts, ...o };
}

/** False for a states-limited broker (California DROP) when the person lives elsewhere. */
function appliesToPerson(broker, person) {
  return !Array.isArray(broker.states) || broker.states.includes(normalizeUsState(person?.state));
}

async function processBroker(context, broker) {
  return processBrokerWithPerson(context, broker, opts.person);
}

/**
 * processBrokerWithPerson - run a single broker opt-out with an explicitly
 * provided person object, without altering the global `opts.person`.
 *
 * @param {object} context  - Playwright browser context
 * @param {object} broker   - broker definition
 * @param {object} person   - person data to fill into the form
 */
async function processBrokerWithPerson(context, broker, person) {
  // Compute the canonical state key for this (broker, person) pair.
  // Single-person mode: bare broker name. Multi-person: "BrokerName|First Last".
  const key = stateKey(broker.name, person, opts.personCount);

  // Save checkpoint so --resume knows where we are when resuming an interrupted run.
  saveCheckpoint(key);

  // Allowlist: the user explicitly wants to STAY listed on this broker, so never
  // submit an opt-out. Logged as 'allowlisted' (routed to the skipped bucket).
  if (isAllowlisted(broker.name, opts.config)) {
    logResult(broker.name, 'allowlisted', 'on allowlist - keeping listing, no opt-out submitted');
    return;
  }

  // Centralized skip logic - handles both regular re-check window AND
  // WP4 pending-confirmation 14-day retry window.
  const skip = shouldSkip(key);
  if (skip) {
    logResult(broker.name, 'skipped', skip.reason);
    return;
  }

  // Skip US-only brokers for non-US users (these sites hold no non-US records)
  if (broker.usOnly && (person?.country || 'US') !== 'US') {
    logResult(broker.name, 'skipped', 'US-only broker - skipped for non-US user');
    return;
  }

  // State-specific programmes (California DROP) apply only to residents; say
  // nothing for everyone else so they do not land in "Action Required".
  if (!appliesToPerson(broker, person)) return;

  if (broker.method === 'manual') {
    logResult(broker.name, 'manual', broker.notes || broker.optOutUrl || '');
    return;
  }

  if (broker.method === 'email') {
    // Handled in sendEmailOptOuts()
    return;
  }

  const page = await context.newPage();
  try {
    let listingUrl = null;

    // Step 1: find your specific listing
    if (broker.method === 'search-form' && broker.searchUrl) {
      try {
        try {
          listingUrl = await findListingUrl(page, broker);
        } catch (err) {
          // --assist: the member clears the challenge in the window, then the
          // search runs once more (the clearance cookie now lets it through).
          if (!(err instanceof BlockedPageError && err.solvable && opts.assist)) throw err;
          if (!(await waitForHumanCheck(page, { brokerName: broker.name }))) {
            throw new BlockedPageError(`${err.reason} (check not completed in time)`);
          }
          try {
            listingUrl = await findListingUrl(page, broker);
          } catch (retryErr) {
            // The site's own post-check redirect can still be in flight.
            if (!/interrupted by another navigation/i.test(retryErr.message || '')) throw retryErr;
            await Promise.resolve().then(() => page.waitForLoadState('load', { timeout: 15000 })).catch(() => {});
            listingUrl = await findListingUrl(page, broker);
          }
        }
      } catch (err) {
        if (err instanceof EgressError) throw err;
        if (err instanceof BlockedPageError) {
          logResult(broker.name, 'manual', `${err.reason} - open in your normal browser: ${broker.optOutUrl}`);
          return;
        }
        logResult(broker.name, 'error', `search page did not load: ${redactUrlsInText(err.message || '').split('\n')[0].slice(0, 80)}`);
        recordFailure(key, 'error');
        return;
      }
      if (!listingUrl) {
        logResult(broker.name, 'notFound', 'Not listed - nothing to remove');
        await page.close();
        return;
      }
      console.log(`     🔗 Listing: ${listingUrl.slice(0, 70)}`);
    }

    // Step 2: navigate to opt-out page (with retry on transient errors)
    let navResp = await withRetry(() => page.goto(broker.optOutUrl, { waitUntil: 'domcontentloaded', timeout: broker.timeoutMs || 15000 }));
    // Bot-protection pages first: Cloudflare serves some challenges with 503,
    // which the error-page guard below would log as a failure (and count
    // toward defunct) instead of handing the member the link.
    const blocked = await checkPageBlockedDetail(page, navResp);
    if (blocked) {
      const assisted = opts.assist && blocked.solvable;
      if (!assisted || !(await waitForHumanCheck(page, { brokerName: broker.name }))) {
        const why = assisted ? `${blocked.reason} (check not completed in time)` : blocked.reason;
        logResult(broker.name, 'manual', `${why} - open in your normal browser: ${broker.optOutUrl}`);
        return;
      }
      // The challenge's status code (403/503) no longer describes the page.
      navResp = null;
    }
    // B13: do not fill/submit against an error page. A 404/410/5xx opt-out URL
    // loads a broker error page; without this guard the form-fill runs against
    // it and can be misclassified as unverified/success. (resp is null for
    // same-document navigations and undefined in mocked tests - both skip here.)
    if (navResp && typeof navResp.status === 'function') {
      const code = navResp.status();
      if (code === 404 || code === 410 || code >= 500) {
        logResult(broker.name, 'error', `opt-out URL returned HTTP ${code}`);
        recordFailure(key, 'error');
        return;
      }
    }
    await jitterSleep(1200, 2200);

    // Inject listing URL into any "profile URL" field
    // Only a URL that really went into a field counts as identifying data.
    let listingFilled = false;
    if (listingUrl) {
      const urlSel = 'input[name*="url" i],input[placeholder*="url" i],input[placeholder*="link" i],input[name*="link" i]';
      const urlField = page.locator(urlSel).first();
      if ((await urlField.count().catch(() => 0)) > 0) {
        listingFilled = await urlField.fill(listingUrl).then(() => true, () => false);
      }
    }

    // Step 3: fill personal info (pass person so intl province/postal aliases fire)
    let fill = { filled: [], missed: [] };
    if (broker.formFields) {
      fill = (await fillForm(page, broker.formFields, person, opts.submissionEmail || undefined)) || fill;
      await jitterSleep(400, 800);
      // Audit 2026-10-10: most live forms had drifted, and the run clicked submit
      // on an empty form. A consent checkbox is not identifying data; a listing
      // URL is.
      const identifying = fill.filled.filter(f => f.kind !== 'checkbox').length + (listingFilled ? 1 : 0);
      if (identifying === 0) {
        logResult(broker.name, 'manual', `form not recognised (none of your details could be filled) - do it by hand: ${broker.optOutUrl}`);
        return;
      }
    }

    // Step 4: solve CAPTCHA if needed
    if (broker.captchaLikely) {
      if (opts.noCapsolver) {
        logResult(broker.name, 'manual', broker.optOutUrl || '');
        await page.close();
        return;
      }
      // Dry run / preview: CapSolver is a paid, direct connection; never call it.
      const solved = opts.dryRun
        ? (console.log('     CAPTCHA expected here; a dry run does not call CapSolver'), true)
        : await detectAndSolveCaptcha(page, opts.capsolver);
      if (!solved) {
        logResult(broker.name, 'captcha_failed', broker.optOutUrl);
        recordFailure(key, 'captcha_failed');
        await page.close();
        return;
      }
    }

    // Step 4b: preview - show what the tool filled, before any submit
    if (opts.preview) {
      const shown = fill.filled.map(f => (f.kind === 'checkbox' ? `${f.selector}=checked` : `${f.selector}="${f.value}"`));
      if (listingFilled) shown.unshift(`listing="${listingUrl}"`);
      const missed = fill.missed.length ? ` | not found: ${fill.missed.join(', ')}` : '';
      const detail = `${shown.join(' ')}${missed} → would submit to ${broker.optOutUrl}`;
      // Filled PII goes to stdout only; the persisted log keeps a redacted line (audit L11).
      logResult(broker.name, 'preview', detail, `preview - ${fill.filled.length} field(s) filled, ${fill.missed.length} not found, values not persisted`);
      await page.close();
      return;
    }

    // Step 5: submit (skipped in dry-run mode)
    if (opts.dryRun) {
      logResult(broker.name, 'skipped', 'dry-run - form filled but not submitted');
      await page.close();
      return;
    }

    // Step 5b: capture pre-submit snapshot for audit trail (if --snapshot enabled).
    // Runs after dry-run guard so PII screenshots are never taken in test/dry-run runs.
    let snapshotFile = null;
    if (opts.snapshot) {
      snapshotFile = await captureSubmitSnapshot(page, broker.name);
    }

    if (broker.submitSelector) {
      // Prefer a submit button inside a <form> element to avoid matching
      // newsletter sign-ups or other out-of-form buttons on the same page.
      const formScopedBtn = page.locator(`form ${broker.submitSelector}`).first();
      const btn = (await formScopedBtn.count()) > 0
        ? formScopedBtn
        : page.locator(broker.submitSelector).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click();
        await jitterSleep(1500, 2500);
      }
    }

    // Step 6: check post-submit page. First detect the page language from
    // <html lang> so non-English brokers classify correctly, then check for an
    // email-confirmation requirement, then verify success via DOM text.
    // Click-then-assume is a false-positive source - forms can fail silently.
    const pageLang = langOf(
      await page.evaluate(
        () => (document.documentElement && document.documentElement.getAttribute('lang')) || ''
      ).catch(() => '')
    );
    const body = await Promise.resolve().then(() => page.evaluate(() => document.body?.innerText || '')).catch(() => '');
    const confirm = await detectConfirmationRequired(page, pageLang);
    const snapshotSuffix = snapshotFile ? ` [snapshot: ${snapshotFile}]` : '';
    if (confirm.pending) {
      logResult(broker.name, 'pending_confirm', (confirm.snippet || 'check your email to confirm') + snapshotSuffix);
      recordPendingConfirmation(key, confirm.snippet);
    } else {
      const { outcome, snippet } = classifyPostSubmit(body, pageLang);
      if (outcome === 'failure') {
        // Form validation error or server error - do NOT start 90-day cooldown
        logResult(broker.name, 'error', (snippet || 'form submission may have failed') + snapshotSuffix);
        recordFailure(key, 'error');
      } else if (outcome === 'success') {
        // Explicit confirmation text found - start 90-day cooldown
        logResult(broker.name, 'success', snippet + snapshotSuffix);
        recordSuccess(key);
      } else {
        // 'unknown' = no confirmation text found - do NOT start 90-day cooldown;
        // next run will re-check so we don't hide silent failures
        logResult(broker.name, 'unverified', 'no explicit confirmation - re-check next run' + snapshotSuffix);
      }
    }

  } catch (err) {
    if (err instanceof EgressError) throw err; // the run stops; finally still closes the page
    const msg = err.message?.includes('Timeout') ? 'Timeout' : redactUrlsInText(err.message || '').slice(0, 80) || 'unknown';
    logResult(broker.name, 'error', msg);
    recordFailure(key, 'error');
  } finally {
    await page.close().catch(() => {});
    await jitterSleep(5000, 15000);
  }
}

module.exports = { configure, processBroker, processBrokerWithPerson, appliesToPerson };
