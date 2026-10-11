#!/usr/bin/env node
/**
 * scripts/inspect-broker-forms.js - read-only survey of broker opt-out pages.
 *
 * Read-only. Uses a dummy person. Never clicks or submits. For each automated
 * broker it loads the opt-out page and records the visible form controls,
 * CAPTCHA presence and whether the page is a bot-protection/block page, so a
 * drifted definition can be repaired from facts.
 *
 *   node scripts/inspect-broker-forms.js [broker name ...]
 *   HEADED=1 WAIT=20000 node scripts/inspect-broker-forms.js TruePeopleSearch
 *   ASSIST=1 node scripts/inspect-broker-forms.js
 *     (visible window; when a site shows a bot check, complete it and the
 *      survey carries on)
 *
 * Output: one JSON file per broker in logs/broker-survey/ (gitignored).
 */
'use strict';
process.umask(0o077);
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadChromium } = require(path.join(ROOT, 'lib/playwright-loader'));
const { buildLaunchOptions } = require(path.join(ROOT, 'lib/browser'));
const { buildStealthScript } = require(path.join(ROOT, 'lib/stealth'));
const { ensureNodeEgress } = require(path.join(ROOT, 'lib/egress'));
const { detectBlockPage, checkPageBlockedDetail } = require(path.join(ROOT, 'lib/block-page'));
const { waitForHumanCheck } = require(path.join(ROOT, 'lib/assist'));
const ASSIST = process.env.ASSIST === '1';
const brokers = require(path.join(ROOT, 'brokers')).forPerson({ firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', state: 'TX', city: 'Austin', zip: '73301', email: 'jane@example.com', country: 'US' });

const OUT = path.join(ROOT, 'logs', 'broker-survey');
const only = process.argv.slice(2);

function dumpFrame() {
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const label = el => {
    let t = '';
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t = l.innerText; }
    if (!t && el.closest('label')) t = el.closest('label').innerText;
    return (t || '').trim().slice(0, 60);
  };
  const forms = [...document.forms];
  // Nearest heading above the control's form, to tell two forms on one page apart.
  const heading = el => {
    const root = el.closest('form') || el;
    const hs = [...document.querySelectorAll('h1,h2,h3,h4,legend')].filter(h => h.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING);
    return hs.length ? hs[hs.length - 1].innerText.trim().slice(0, 60) : '';
  };
  const controls = [...document.querySelectorAll('input,select,textarea')].filter(el => el.type !== 'hidden' && vis(el)).map(el => ({
    tag: el.tagName.toLowerCase(), type: el.type, name: el.name, id: el.id,
    placeholder: el.placeholder || '', aria: el.getAttribute('aria-label') || '', label: label(el),
    form: forms.indexOf(el.form), heading: heading(el),
    options: el.tagName === 'SELECT' ? [...el.options].slice(0, 8).map(o => `${o.value}=${o.text.trim().slice(0, 20)}`) : undefined,
  }));
  const buttons = [...document.querySelectorAll('button,input[type=submit]')].filter(vis)
    .map(b => ({ text: (b.innerText || b.value || '').trim().slice(0, 40), id: b.id, inForm: !!b.closest('form') })).slice(0, 25);
  const links = [...document.querySelectorAll('a')].filter(vis)
    .map(a => ({ text: (a.innerText || '').trim().slice(0, 50), href: a.getAttribute('href') || '' }))
    .filter(a => /opt|remov|suppress|delete|privacy|continue|start|begin|record/i.test(a.text + ' ' + a.href)).slice(0, 25);
  const captcha = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,.cf-turnstile');
  const text = document.body ? document.body.innerText.slice(0, 2000) : '';
  return { controls, buttons, links, captcha, text };
}

(async () => {
  // Same rule as a run: nothing leaves this machine unless it goes out via Mullvad.
  await ensureNodeEgress({ network: { required: true } });
  fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
  const chromium = loadChromium();
  const browser = await chromium.launch(buildLaunchOptions({ headless: process.env.HEADED !== '1' && !ASSIST }));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(buildStealthScript()).catch(() => {});
  // Arguments are broker names, or page URLs to survey as they are.
  const urls = only.filter(a => /^https?:\/\//i.test(a)).map(u => ({ name: new URL(u).hostname + new URL(u).pathname, optOutUrl: u }));
  const names = only.filter(a => !/^https?:\/\//i.test(a));
  const targets = [...brokers.filter(b => b.method !== 'manual' && b.method !== 'email' && (only.length ? names.includes(b.name) : true)), ...urls];
  for (const b of targets) {
    const page = await ctx.newPage();
    const out = { name: b.name, url: b.optOutUrl, formFields: Object.keys(b.formFields || {}), at: new Date().toISOString() };
    try {
      const resp = await page.goto(b.optOutUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
      out.status = resp ? resp.status() : null;
      if (ASSIST) {
        const blocked = await checkPageBlockedDetail(page, resp);
        if (blocked && blocked.solvable) out.assisted = await waitForHumanCheck(page, { brokerName: b.name });
      }
      await page.waitForTimeout(Number(process.env.WAIT || 5000));
      out.finalUrl = page.url();
      out.title = await page.title();
      out.main = await page.mainFrame().evaluate(dumpFrame);
      out.frames = [];
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const d = await f.evaluate(dumpFrame).catch(() => null);
        if (d && d.controls.length) out.frames.push({ url: f.url(), ...d });
      }
      out.blocked = detectBlockPage({ status: out.status, title: out.title, text: out.main.text });
      out.main.text = out.main.text.slice(0, 1500);
    } catch (e) {
      out.error = String(e.message).split('\n')[0];
    }
    fs.writeFileSync(path.join(OUT, `${b.name.replace(/[^\w.-]+/g, '_')}.json`), JSON.stringify(out, null, 1), { mode: 0o600 });
    const n = out.main ? out.main.controls.length : 0;
    console.log(`${b.name.padEnd(26)} ${String(out.status || '-').padEnd(4)} controls=${n} captcha=${!!out.main?.captcha} ${out.blocked || out.error || ''}`);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
