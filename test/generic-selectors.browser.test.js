'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = Boolean(process.env.UPEC_WIPE_BROWSER_TESTS);

describe('generic-runner combined locators (real browser)', { skip: !ENABLED }, () => {
  let browser;
  let page;
  before(async () => {
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  after(async () => { if (browser) await browser.close(); });

  test('Do Not Sell: a hidden match is skipped and the visible one is clicked', async () => {
    const { _clickDoNotSell } = require('../generic-runner');
    await page.setContent('<a href="#" style="display:none" onclick="window.hit=\'hidden\'">Do Not Sell</a><button onclick="window.hit=\'shown\'">Do Not Sell My Info</button>');
    assert.equal(await _clickDoNotSell(page), true);
    assert.equal(await page.evaluate(() => window.hit), 'shown');
  });

  test('cookie banner: the visible reject button is clicked', async () => {
    const { _dismissBanners } = require('../generic-runner');
    await page.setContent('<button id="onetrust-reject-all-handler" onclick="window.hit=1">Reject All</button>');
    await _dismissBanners(page);
    assert.equal(await page.evaluate(() => window.hit), 1);
  });

  test('nothing visible: no click, false', async () => {
    const { _clickDoNotSell } = require('../generic-runner');
    await page.setContent('<p>No links here</p>');
    assert.equal(await _clickDoNotSell(page), false);
  });
});
