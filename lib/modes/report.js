'use strict';
/**
 * lib/modes/report.js - --report: build monthly PDF + emailable HTML report and exit (moved from watcher.js).
 */
const fs = require('fs');
const { STATE_PATH, loadConfig, loadState } = require('../config');
const { loadChromium } = require('../playwright-loader');
const lock = require('../lock');
const { openBrowserSession } = require('../browser-session');
const { acquireStateLockOrExit } = require('./shared');

// ── --report: build monthly PDF + emailable HTML report and exit ─────────────
async function run() {
  const brokers = require('../../brokers');
  const { buildReportModel, renderReportHtml, renderReportPdf, reportPdfPath, REPORT_DIR } = require('../report');
  const {
    computeExposureScore,
    serpResultsFromHistory,
    loadExposureHistory,
    exposureToReportAdapter,
  } = require('../exposure');

  let chromiumForReport;
  chromiumForReport = loadChromium();

  const reportConfig = loadConfig();

  const REPORT_LOCK_PATH = STATE_PATH + '.lock';
  acquireStateLockOrExit();

  return (async () => {
    const state = loadState();

    // Compute current exposure so the report can show a real trend.
    const serpResultsForReport = serpResultsFromHistory(require('../serp-scan').readHistory());
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
}

module.exports = { run };
