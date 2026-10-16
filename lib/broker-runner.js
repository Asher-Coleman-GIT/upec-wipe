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

const { recordSuccess, recordPendingConfirmation, recordFailure, recordAttempt, recordManual, shouldSkip, saveCheckpoint, stateKey } = require('./config');
const { logResult, results } = require('./logger');
const { fillForm, findListingUrl } = require('./forms');
const { isAllowlisted } = require('./filter');
const { detectAndSolveCaptcha } = require('./captcha');
const { EgressError } = require('./egress');
const { detectConfirmationRequired } = require('./confirm');
const { classifyPostSubmit } = require('./success');
const { redactUrlsInText, dropPersonalQueries, redactPersonValues } = require('./redact');
const { langOf } = require('./locale-patterns');
const { withRetry } = require('./retry');
const { jitterSleep } = require('./timing');
const { checkPageBlockedDetail, BlockedPageError } = require('./block-page');
const { waitForHumanCheck } = require('./assist');
const { searchListing } = require('./verify-search');
const { parseDob } = require('./dob');
const { hostnameOf, registrableDomain } = require('./domain');
const { normalizeUsState } = require('./us-state');

const DEFAULT_OPTIONS = { dryRun: false, person: null, capsolver: null, noCapsolver: false, personCount: 1, config: null, submissionEmail: null };

// The default runner, kept for older callers and tests: configure() changes it.
let opts = { ...DEFAULT_OPTIONS };

function configure(o) {
  opts = { ...opts, ...o };
}

/**
 * A runner bound to one set of options (one person in one run). Two runners
 * never share options, so one person's settings cannot leak into another's.
 */
function createBrokerRunner(options) {
  const own = { ...DEFAULT_OPTIONS, ...options };
  return {
    processBroker: (context, broker) => runBroker(own, context, broker, own.person),
    processBrokerWithPerson: (context, broker, person) => runBroker(own, context, broker, person),
    appliesToPerson,
  };
}

/** False for a states-limited broker (California DROP) when the person lives elsewhere. */
function appliesToPerson(broker, person) {
  return !Array.isArray(broker.states) || broker.states.includes(normalizeUsState(person?.state));
}

async function processBroker(context, broker) {
  return runBroker(opts, context, broker, opts.person);
}

/**
 * runBroker - run one broker opt-out for `person` with the given runner
 * options. The default runner and createBrokerRunner both call it; it never
 * changes the default runner's options.
 *
 * @param {object} context  - Playwright browser context
 * @param {object} broker   - broker definition
 * @param {object} person   - person data to fill into the form
 * @param {object} opts     - runner options
 */
async function runBroker(opts, context, broker, person) {
  // Compute the canonical state key for this (broker, person) pair.
  // Single-person mode: bare broker name. Multi-person: "BrokerName|First Last".
  const key = stateKey(broker.name, person, opts.personCount);
  // Hand a site to the member: log it, and remember it (not on a dry run) so
  // `upec-wipe manual` can list it with its link later.
  // Page excerpts echo what was submitted (name, city, ZIP, the alias): they
  // are logged and saved only with those removed (review 2026-10-15).
  const scrub = (text) => redactPersonValues(text, [person], [opts.submissionEmail]);
  const manual = (raw) => {
    // A prefilled link (CheckPeople's carries the name) stays out of the card.
    const detail = dropPersonalQueries(raw, [person]);
    logResult(broker.name, 'manual', detail);
    if (!opts.dryRun) recordManual(key, detail);
  };

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
  // A rehearsal (preview, dry run) fills the dummy person, so the member's
  // own history does not decide which forms it opens.
  const skip = opts.rehearsal ? null : shouldSkip(key);
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

  // A form that needs a detail the member chose not to give (PrivateRecords
  // requires a date of birth) would only be rejected: hand it over instead.
  if (Array.isArray(broker.requires) && broker.requires.includes('dob') && !parseDob(person?.dob)) {
    manual(`needs your date of birth (add it with setup) - or do it by hand: ${broker.optOutUrl}`);
    return;
  }

  if (broker.method === 'manual') {
    manual(broker.notes || broker.optOutUrl || '');
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
    if (broker.method === 'search-form' && (broker.searchUrl || broker.verifySearch) && opts.rehearsal) {
      // A rehearsal fills the dummy person: a search for them proves nothing.
      console.log('     listing search skipped in a preview');
    } else if (broker.method === 'search-form' && (broker.searchUrl || broker.verifySearch)) {
      try {
        if (broker.verifySearch) {
          // A card matches only on first + last name and city: without them no
          // card can match, and "not listed" would skip the opt-out (review
          // 2026-10-15). verify reports the same case as unverifiable.
          const missing = ['firstName', 'lastName', 'city'].filter(f => !String((person && person[f]) || '').trim());
          if (missing.length) {
            manual(`your ${missing.includes('city') ? 'city' : 'name'} is not in your setup, so the listing search cannot find you - add it with upec-wipe setup, or do it by hand: ${broker.optOutUrl}`);
            await page.close();
            return;
          }
          // Name + city in a result card, the same search verify reads
          // (lib/verify-search.js); it waits at a bot check with --assist.
          listingUrl = await searchListing(page, broker, person, { assist: opts.assist });
        } else {
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
        }
      } catch (err) {
        if (err instanceof EgressError) throw err;
        if (err instanceof BlockedPageError) {
          manual(`${err.reason} - open in your normal browser: ${broker.optOutUrl}`);
          return;
        }
        logResult(broker.name, 'error', `search page did not load: ${redactUrlsInText(err.message || '').split('\n')[0].slice(0, 80)}`);
        recordFailure(key, 'error');
        return;
      }
      if (!listingUrl) {
        logResult(broker.name, 'notFound', 'Not listed - nothing to remove');
        if (!opts.dryRun) recordAttempt(key, 'not_found');
        await page.close();
        return;
      }
      console.log(`     Listing: ${listingUrl.slice(0, 70)}`);
      // The form cannot be completed by the tool (MyLife's embedded Jotform
      // needs its email widget): hand over the listing and the form instead.
      if (broker.manualAfterSearch) {
        manual(`you are listed at ${listingUrl} - request removal at ${broker.optOutUrl}${broker.notes ? ' (' + broker.notes + ')' : ''}`);
        await page.close();
        return;
      }
    }

    // --no-capsolver: a CAPTCHA broker goes to the member before its form is
    // opened. Filling it first put the details into a page that was then
    // abandoned (page scripts can read unsubmitted fields; review 2026-10-15).
    if (broker.captchaLikely && opts.noCapsolver) {
      manual(broker.optOutUrl || '');
      await page.close();
      return;
    }

    // Step 2: navigate to opt-out page (with retry on transient errors)
    let navResp = await withRetry(() => page.goto(broker.optOutUrl, { waitUntil: 'domcontentloaded', timeout: broker.timeoutMs || 15000 }));
    // Bot-protection pages first: Cloudflare serves some challenges with 503,
    // which the error-page guard below would log as a failure (and count
    // toward defunct) instead of handing the member the link.
    const blocked = await checkPageBlockedDetail(page, navResp);
    if (blocked) {
      if (!opts.assist && blocked.solvable) results.assistable.push(broker.name);
      const assisted = opts.assist && blocked.solvable;
      if (!assisted || !(await waitForHumanCheck(page, { brokerName: broker.name }))) {
        const why = assisted ? `${blocked.reason} (check not completed in time)` : blocked.reason;
        manual(`${why} - open in your normal browser: ${broker.optOutUrl}`);
        return;
      }
      // The challenge's status code (403/503) no longer describes the page.
      navResp = null;
    }
    // Catalog sites were reviewed on their own domain (or a recorded privacy
    // platform). If the page now lands anywhere else, fill nothing.
    if (broker.source === 'catalog' && broker.domain) {
      const host = hostnameOf(typeof page.url === 'function' ? page.url() : broker.optOutUrl).replace(/\.$/, '');
      const own = host === broker.domain || host.endsWith(`.${broker.domain}`);
      const platform = (broker.formHosts || []).includes(registrableDomain(host));
      if (!own && !platform) {
        manual(`the opt-out page now goes to ${host || 'an unknown page'} - check it by hand: ${broker.optOutUrl}`);
        return;
      }
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

    // Some opt-out pages show the form only after a button (PeopleFinders'
    // "Next", 2026-10-14). Click it once when visible; nothing is typed.
    if (broker.startSelector) {
      const start = page.locator(broker.startSelector).first();
      if (await start.isVisible().catch(() => false)) {
        await start.click().catch(() => {});
        await jitterSleep(1200, 2000);
      }
    }

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
        manual(`form not recognised (none of your details could be filled) - do it by hand: ${broker.optOutUrl}`);
        return;
      }
    }

    // Step 4: solve CAPTCHA if needed
    if (broker.captchaLikely) {
      // Dry run / preview: CapSolver is a paid, direct connection; never call it.
      const solved = opts.dryRun
        ? (console.log('     CAPTCHA expected here; a dry run does not call CapSolver'), true)
        : await detectAndSolveCaptcha(page, opts.capsolver, broker, {
          assist: opts.assist, onAssistable: () => results.assistable.push(broker.name),
        });
      if (!solved) {
        const handOff = dropPersonalQueries(broker.optOutUrl || '', [person]);
        logResult(broker.name, 'captcha_failed', handOff);
        recordFailure(key, 'captcha_failed');
        recordManual(key, `the CAPTCHA could not be solved - do it by hand: ${handOff}`);
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

    let clicked = false;
    if (broker.submitSelector) {
      // Prefer a submit button inside a <form> element to avoid matching
      // newsletter sign-ups or other out-of-form buttons on the same page.
      const formScopedBtn = page.locator(`form ${broker.submitSelector}`).first();
      const btn = (await formScopedBtn.count()) > 0
        ? formScopedBtn
        : page.locator(broker.submitSelector).first();
      if ((await btn.count()) > 0 && (await btn.isVisible())) {
        await btn.click();
        clicked = true;
        await jitterSleep(1500, 2500);
      }
    }
    // Nothing was sent (the selector drifted, the button is hidden or disabled
    // after a CAPTCHA, or none is defined). Classifying the form page itself
    // read its instructions as success (review 2026-10-15).
    if (!clicked) {
      manual(`the submit button was not found - finish by hand: ${broker.optOutUrl}`);
      await page.close();
      return;
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
    // Failure wording wins: "Invalid email. Please check your email address"
    // also reads as "check your email" (review 2026-10-15).
    const classified = classifyPostSubmit(body, pageLang);
    const confirm = classified.outcome === 'failure' ? { pending: false } : await detectConfirmationRequired(page, pageLang);
    if (confirm.pending) {
      const snippet = scrub(confirm.snippet || '');
      logResult(broker.name, 'pending_confirm', (snippet || 'check your email to confirm'));
      recordPendingConfirmation(key, snippet);
    } else {
      const { outcome, snippet } = classified;
      if (outcome === 'failure') {
        // Form validation error or server error - do NOT start 90-day cooldown
        logResult(broker.name, 'error', (scrub(snippet) || 'form submission may have failed'));
        recordFailure(key, 'error');
      } else if (outcome === 'success') {
        // Explicit confirmation text found - start 90-day cooldown
        logResult(broker.name, 'success', scrub(snippet));
        recordSuccess(key);
      } else {
        // 'unknown' = no confirmation text found - do NOT start 90-day cooldown;
        // next run will re-check so we don't hide silent failures
        logResult(broker.name, 'unverified', 'no explicit confirmation - re-check next run');
        recordAttempt(key, 'unverified');
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

async function processBrokerWithPerson(context, broker, person) {
  return runBroker(opts, context, broker, person);
}

module.exports = { configure, processBroker, processBrokerWithPerson, appliesToPerson, createBrokerRunner };
