/**
 * lib/forms.js
 *
 * Smart form filler + listing-URL discovery.
 *
 * International support: applyRegionAliases() expands a formFields map so that
 * values mapped to US state/zip selectors also get attempted against common
 * province/postal/postcode variants and a country <select>. fillForm() calls
 * this automatically when a `person` context is present.
 */

const { jitterSleep } = require('./timing');
const { normalizeUsState, usStateName } = require('./us-state');
const { resolveField, clearResolveMarker } = require('./field-resolver');
const { checkPageBlockedDetail, BlockedPageError } = require('./block-page');

/**
 * Augment a formFields map for non-US users so that province/postal/postcode
 * selectors are tried in addition to the usual state/zip selectors, and a
 * country <select> is targeted when the person's country is non-US.
 *
 * For US users the map is returned unchanged (fast path, no allocation).
 *
 * This is a pure transform - no side effects, no Playwright calls.
 *
 * @param {Record<string,string>} formFields  Selector→value map
 * @param {{ country?: string, state?: string, zip?: string }} person  Person config
 * @returns {Record<string,string>}  Possibly-augmented map (new object for non-US)
 */
function applyRegionAliases(formFields, person) {
  const country = (person.country || 'US').toUpperCase();
  if (country === 'US') return formFields;

  const augmented = { ...formFields };

  // Find the value currently mapped to a state-style selector and also map it
  // to province/region selectors
  for (const [sel, val] of Object.entries(formFields)) {
    if (/state/i.test(sel)) {
      augmented[
        'input[name*="province" i],input[name*="region" i],input[placeholder*="province" i]'
      ] = val;
    }
    if (/zip/i.test(sel) || /postal/i.test(sel)) {
      augmented[
        'input[name*="postal" i],input[name*="postcode" i],input[placeholder*="postal" i],input[placeholder*="postcode" i]'
      ] = val;
    }
  }

  // Target a country <select> when present - try the full name, then the code
  augmented['select[name*="country" i]'] = country;

  return augmented;
}

/**
 * Keywords too generic for safe getByLabel() fallback.
 * 'first' matches 'First Observed Date', 'first_name_on_account', etc.
 * 'last'  matches 'Last Modified', 'Last Login', etc.
 * 'name'  matches 'Username', 'Company Name', 'File Name', etc.
 * 'address' matches 'Billing Address', 'IP Address', etc.
 * 'number' matches 'Order Number', 'Phone Number (hidden field)', etc.
 * Specific keywords like 'email', 'zip', 'phone', 'city' are safe to keep.
 */
const AMBIGUOUS_KEYWORDS = new Set(['first', 'last', 'name', 'middle', 'address', 'number']);

/**
 * Returns true when a keyword is too generic for a safe getByLabel() fallback.
 * @param {string} kw
 */
function isAmbiguousKeyword(kw) {
  return AMBIGUOUS_KEYWORDS.has((kw || '').toLowerCase());
}

/**
 * Extracts the substring-match keyword from a CSS attribute selector.
 * Returns null when no *="..." pattern is found.
 * @param {string} selector
 * @returns {string|null}
 */
function extractKeyword(selector) {
  const m = selector.match(/\*="([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Returns true when a CSS selector targets an email input field.
 * Matches name/id/placeholder substrings of "email" and type="email".
 * @param {string} selector
 * @returns {boolean}
 */
function isEmailSelector(selector) {
  return /type=["']?email|\bemail\b/i.test(selector || '');
}

/**
 * Fill every field in `formFields` on `page`. When `person` is provided,
 * applyRegionAliases() is called first so non-US province/postal selectors are
 * also attempted. For US users there is zero overhead - the map is returned as-is.
 *
 * When `submissionEmail` is provided, any field whose selector targets an email
 * input is filled with that masked/relay address instead of the value baked
 * into `formFields`. This keeps a real email address out of broker submissions.
 *
 * @param {import('playwright').Page} page
 * @param {Record<string,string>} formFields
 * @param {{ country?: string, state?: string, zip?: string }} [person]
 * @param {string} [submissionEmail]  Masked/relay email to use for email fields
 */
const kindOf = (tag, type) => (tag === 'select' ? 'select' : (type === 'checkbox' || type === 'radio') ? 'checkbox' : 'text');

// Tag and input type in one browser round trip.
function kindInfo(el) {
  return el.evaluate(n => ({ tag: n.tagName.toLowerCase(), type: n.type || '' }));
}

/**
 * Put `value` into `el` the way its element kind needs. Resolves true only
 * when the action succeeded, so a swallowed failure is never reported as a
 * fill (final review 2026-10-10: phantom fills defeated the empty-form guard).
 */
async function applyValue(el, tag, type, value) {
  try {
    if (tag === 'select') {
      // A US state can be listed as "UT" or as "Utah"; try what was given,
      // then the other form, each as label and then as value.
      const alt = [normalizeUsState(value), usStateName(value)].filter(v => v && v !== value);
      // Pick from the options the page really has. selectOption() on an
      // option that is not there waits out Playwright's timeout (30 s each),
      // which cost 60-120 s per select on the live forms and let the page move
      // on (first supervised run, 2026-10-14).
      const options = await el.evaluate(n => Array.from(n.options || [], o => ({ value: o.value, label: String(o.label || o.text || '').trim() }))).catch(() => []);
      if (options.length) {
        const norm = (v) => String(v).trim().toLowerCase();
        let hit = null;
        for (const v of [value, ...alt]) {
          const want = norm(v);
          hit = options.find(o => norm(o.label) === want) || options.find(o => o.value !== '' && norm(o.value) === want);
          if (hit) break;
        }
        if (!hit) return false;
        await el.selectOption({ value: hit.value });
        return true;
      }
      let done = false;
      for (const v of [value, ...alt]) {
        try { await el.selectOption({ label: v }); done = true; break; } catch (_labelErr) { /* try value */ }
        try { await el.selectOption(v); done = true; break; } catch (_valueErr) { /* next form */ }
      }
      if (!done) return false;
    } else if (type === 'checkbox' || type === 'radio') {
      await el.check();
    } else {
      await el.fill(value);
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Fill a broker form. Returns { filled: [{ selector, value, kind }], missed }
 * so the caller can refuse to submit a form none of the person's details
 * reached. Empty values appear in neither list.
 */
async function fillForm(page, formFields, person, submissionEmail) {
  const fields = person ? applyRegionAliases(formFields, person) : formFields;
  const report = { filled: [], missed: [] };

  for (const [selector, rawValue] of Object.entries(fields)) {
    // Swap by value as well as by selector: '#o_email' is not caught by the
    // selector test ("_" defeats \bemail\b) and sent the real email on
    // 2026-10-10. Whatever a broker calls the field, the member's real email
    // never goes in when a relay alias is set.
    const isRealEmail = !!(person && person.email) && String(rawValue).trim().toLowerCase() === String(person.email).trim().toLowerCase();
    const value = (submissionEmail && (isEmailSelector(selector) || isRealEmail)) ? submissionEmail : rawValue;
    // Nothing to say for this field: leave it alone. Filling undefined throws
    // into the catch below and then hands undefined to the semantic resolver;
    // filling '' wipes a value the broker may have prefilled. "undefined" as a
    // literal string means a template lost its value upstream - never send it
    // to a third party.
    if (value == null || String(value).trim() === '' || value === 'undefined') continue;
    const selectors = selector.split(',').map(s => s.trim());
    let filled = false;
    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        // A ticked box or radio can reveal the rest of the form a moment
        // later (PrivateRecords' "Remove My Information"). Only then is a
        // hidden field worth waiting for.
        // isVisible() is false when nothing matches, so no count() is needed.
        if (report.filled.some(f => f.kind === 'checkbox') && !(await el.isVisible())) {
          await Promise.resolve().then(() => el.waitFor({ state: 'visible', timeout: 2000 })).catch(() => {});
        }
        if (await el.isVisible()) {
          const { tag, type } = await kindInfo(el);
          if (await applyValue(el, tag, type, value)) {
            report.filled.push({ selector, value: String(value), kind: kindOf(tag, type) });
            filled = true;
            break;
          }
          if (tag === 'select') {
            // Never log `value`: this map carries the user's state, city,
            // zip, country and name, and stdout ends up in logs/, journald
            // and `docker logs`. The
            // selector is the half that makes selector drift debuggable.
            console.warn(`[forms] select unmatched: selector="${sel}" (value withheld, ${String(value).length} chars) - neither label nor value found`);
          }
        }
      } catch(_) {}
    }
    if (!filled) {
      // Primary fallback: getByLabel - only fires when the selector contains a
      // *="..." substring match AND the extracted keyword is not ambiguous.
      const kw = extractKeyword(selector);
      if (kw && !isAmbiguousKeyword(kw)) {
        // Escape regex metacharacters before constructing the RegExp so that
        // keywords like "na(me" do not cause a SyntaxError.
        const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const labelLocator = page.getByLabel(new RegExp(escaped, 'i'));
        // Only flag the field as filled when getByLabel actually matched an
        // element. A silent miss (no associated <label>) must NOT short-circuit
        // the semantic resolver below - otherwise the renamed-attr + no-label
        // failure mode, the exact case the resolver targets, is never reached.
        const matched = await labelLocator.count().catch(() => 0);
        if (matched > 0) {
          const target = labelLocator.first();
          const { tag, type } = await Promise.resolve().then(() => kindInfo(target)).catch(() => ({ tag: '', type: '' }));
          // A label such as "Email me offers" can sit on a checkbox: never tick
          // a box because a text field's keyword matched its label.
          if (kindOf(tag, type) !== 'checkbox' && await applyValue(target, tag, type, value)) {
            report.filled.push({ selector, value: String(value), kind: kindOf(tag, type) });
            filled = true; // genuine hit - prevent double-fill via semantic fallback
          }
        }
      }
    }
    if (!filled) {
      // Secondary fallback: semantic field resolver. Fires when the primary
      // fallback was skipped (selector has no *="..." pattern - i.e. exact
      // selectors like input[name="email"] - or the keyword was ambiguous).
      // resolveField() scores visible elements by multi-signal heuristic and
      // returns the best match above a conservative threshold, or null.
      const resolved = await resolveField(page, selector, value).catch(() => null);
      if (resolved) {
        try {
          const { tag, type } = await kindInfo(resolved).catch(() => ({ tag: '', type: '' }));
          if (await applyValue(resolved, tag, type, value)) {
            report.filled.push({ selector, value: String(value), kind: kindOf(tag, type) });
            filled = true;
          }
        } finally {
          // Clear the snapshot marker the resolver set on the winning element,
          // so the next field's resolve pass starts from a clean DOM.
          await clearResolveMarker(page);
        }
      }
    }
    if (!filled) report.missed.push(selector);
  }
  return report;
}

async function findListingUrl(page, broker) {
  // P4: use 'domcontentloaded' rather than 'networkidle'. Tracker-heavy broker
  // sites keep the network busy indefinitely, so 'networkidle' frequently waits
  // the full 20s timeout. domcontentloaded returns once the DOM is parsed; the
  // jitter sleep below gives late-rendered listing links time to appear.
  const resp = await page.goto(broker.searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await jitterSleep(1500, 2500);
  // A challenge or block page has no listing links; reading it as "not listed"
  // made the run say nothing to remove and --verify say "verified clear".
  const blocked = await checkPageBlockedDetail(page, resp);
  if (blocked) throw new BlockedPageError(blocked.reason, { solvable: blocked.solvable });
  // A moved or broken search URL (MyLife, 2026-10-15: 404) has no listing
  // links either; reading it as "not listed" hid the broken search.
  const status = resp && typeof resp.status === 'function' ? resp.status() : null;
  if (status >= 400) throw new Error(`search page answered HTTP ${status}`);
  // Pass both source and flags so the 'i' (and any other flags) on the original
  // RegExp are preserved inside page.evaluate. Passing only .source drops the flags
  // because new RegExp(src) without a second argument is case-sensitive.
  const links = await page.evaluate(({ src, flags }) => {
    const re = new RegExp(src, flags);
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.href)
      .filter(h => re.test(h));
  }, { src: broker.listingPattern.source, flags: broker.listingPattern.flags });
  return links[0] || null;
}

module.exports = { fillForm, findListingUrl, applyRegionAliases, isAmbiguousKeyword, extractKeyword, isEmailSelector };
