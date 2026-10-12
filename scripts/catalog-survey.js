#!/usr/bin/env node
/**
 * scripts/catalog-survey.js - read-only survey of catalog candidates.
 *
 *   node scripts/catalog-survey.js                     every candidate
 *   node scripts/catalog-survey.js --group blocked     only sites last grouped "blocked"
 *   node scripts/catalog-survey.js --only a.com,b.com
 *   node scripts/catalog-survey.js --resume            skip sites surveyed in the last 7 days
 *   node scripts/catalog-survey.js --reviewed          reviewed sites only, report drift (upec-wipe catalog-check)
 *   ASSIST=1 node scripts/catalog-survey.js --group blocked   visible window; complete each bot check
 *
 * Opens pages and follows opt-out links by URL. Never clicks, types or
 * submits. Uses no personal data. Writes data/catalog/<domain>.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadChromium } = require(path.join(ROOT, 'lib/playwright-loader'));
const { buildLaunchOptions } = require(path.join(ROOT, 'lib/browser'));
const { buildStealthScript } = require(path.join(ROOT, 'lib/stealth'));
const { ensureNodeEgress } = require(path.join(ROOT, 'lib/egress'));
const { checkPageBlockedDetail } = require(path.join(ROOT, 'lib/block-page'));
const { waitForHumanCheck } = require(path.join(ROOT, 'lib/assist'));
const { dumpFrame } = require(path.join(ROOT, 'lib/page-dump'));
const { CATALOG_DIR } = require(path.join(ROOT, 'lib/catalog'));
const core = require(path.join(ROOT, 'lib/catalog-survey-core'));
const { detectDrift, applyDrift } = require(path.join(ROOT, 'lib/catalog-drift'));

const ASSIST = process.env.ASSIST === '1';
const WAIT = Number(process.env.WAIT || 3000);
const RESUME_DAYS = 7;
const argv = process.argv.slice(2);
const argOf = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const GROUP = argOf('--group');
const ONLY = (argOf('--only') || '').split(',').map(s => s.trim()).filter(Boolean);
const RESUME = argv.includes('--resume');
const REVIEWED = argv.includes('--reviewed');

function readRecord(domain) {
  try { return JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, `${domain}.json`), 'utf8')); } catch (_) { return null; }
}

function wanted(cand, rec) {
  if (ONLY.length && !ONLY.includes(cand.domain)) return false;
  if (REVIEWED) return !!(rec && rec.review && rec.review.state === 'reviewed');
  if (GROUP && (!rec || rec.group !== GROUP)) return false;
  if (RESUME && rec && rec.survey && rec.survey.checkedAt && (Date.now() - Date.parse(rec.survey.checkedAt)) < RESUME_DAYS * 864e5) return false;
  return true;
}

async function surveyOne(ctx, cand, rec) {
  const page = await ctx.newPage();
  const out = { checkedAt: new Date().toISOString() };
  try {
    // A reviewed site is checked at its reviewed opt-out page.
    const start = (rec && rec.review && rec.review.definition && rec.review.definition.optOutUrl) || cand.urls[0];
    const resp = await page.goto(start, { waitUntil: 'domcontentloaded', timeout: 25000 });
    out.status = resp ? resp.status() : null;
    let blocked = await checkPageBlockedDetail(page, resp);
    if (blocked && blocked.solvable && ASSIST && await waitForHumanCheck(page, { brokerName: cand.domain })) blocked = null;
    await page.waitForTimeout(WAIT);
    let dump = await page.mainFrame().evaluate(dumpFrame);
    let title = await page.title();
    if (!blocked && !REVIEWED && !core.hasIdentityField(dump.controls)) {
      for (const next of core.optOutLinks(dump.links, page.url(), cand.domain)) {
        const r2 = await page.goto(next, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => null);
        if (!r2) continue;
        await page.waitForTimeout(WAIT);
        const d2 = await page.mainFrame().evaluate(dumpFrame).catch(() => null);
        if (d2 && core.hasIdentityField(d2.controls)) { dump = d2; out.status = r2.status(); title = await page.title(); break; }
      }
    }
    out.optOutUrl = page.url();
    out.title = title;
    out.block = blocked ? (blocked.solvable ? 'challenge' : 'hard') : null;
    out.controls = dump.controls;
    out.buttons = dump.buttons;
    out.captcha = dump.captcha;
    out.contacts = core.emailContacts(dump.links, cand.domain);
    // Addresses go in contacts only; page text keeps no email addresses.
    out.text = String(dump.text || '').slice(0, 600).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
    out.fingerprint = core.fingerprint(dump.controls);
    out.group = core.classifyGroup({ status: out.status, blocked, title, text: dump.text, controls: dump.controls });
  } catch (e) {
    out.error = String(e.message).split('\n')[0];
    out.group = core.classifyGroup({ error: out.error });
  }
  await page.close().catch(() => {});
  return out;
}

(async () => {
  // Same rule as a run: nothing leaves this machine unless it goes out via Mullvad.
  await ensureNodeEgress({ network: { required: true } });
  const candidates = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, 'candidates.json'), 'utf8'));
  const todo = candidates.map(c => [c, readRecord(c.domain)]).filter(([c, r]) => wanted(c, r));
  console.log(`Surveying ${todo.length} site(s)${ASSIST ? ' with ASSIST (complete each bot check in the window)' : ''}.`);
  const chromium = loadChromium();
  const browser = await chromium.launch(buildLaunchOptions({ headless: !ASSIST }));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  await ctx.addInitScript(buildStealthScript()).catch(() => {});
  const today = new Date().toISOString().slice(0, 10);
  const drifted = [];
  let n = 0;
  for (const [cand, rec] of todo) {
    const survey = await surveyOne(ctx, cand, rec);
    const reason = detectDrift(rec, survey);
    let record = core.mergeSurvey(rec, cand, survey);
    if (reason) { record = applyDrift(record, reason, today); drifted.push(`${cand.domain}: ${reason}`); }
    core.writeRecordAtomic(CATALOG_DIR, record);
    n += 1;
    console.log(`${String(n).padStart(4)}/${todo.length} ${cand.domain.padEnd(34)} ${record.group.padEnd(14)} ${survey.status || '-'} controls=${(survey.controls || []).length}${reason ? ' DRIFT: ' + reason : ''}${survey.error ? ' ' + survey.error.slice(0, 60) : ''}`);
  }
  await browser.close();
  if (REVIEWED) console.log(drifted.length ? `\n${drifted.length} reviewed site(s) changed and now need review:\n  ${drifted.join('\n  ')}` : '\nNo reviewed site changed.');
})().catch(e => { console.error(e.message); process.exit(1); });
