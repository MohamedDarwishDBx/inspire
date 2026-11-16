// D-NOAGENT (Amr 2026-11-16 02:27): the Agent link is hidden in the left nav for every experience. An agentic App lands on
// its first normal page, and a deep link to #/<page>/agent falls back to the dashboard instead of a blank page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

// The App experiences are agentic, both and ui (ui is the classic App with no agent; there is no 'classic' value).
const EXPERIENCES = ['agentic', 'both', 'ui'];
const options = (experience) => ({ options: { modify: false, replace_edits: false, decisions: true, alerts: false, experience } });

for (const experience of EXPERIENCES) {
  test(`the left nav has no Agent link for experience '${experience}'`, async () => {
    const info = appInfo(options(experience));
    const pageId = info.pages[0].id;
    const { page, seen, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}/dashboard` });
    try {
      await page.locator('nav.side [data-rail="dashboard"]').waitFor({ timeout: 20000 });
      assert.equal(await page.locator('nav.side [data-rail="agent"]').count(), 0, 'no agent rail item');
      const labels = await page.locator('nav.side .rail-i b').allInnerTexts();
      assert.ok(labels.length > 0, 'the rail has its normal sections');
      assert.ok(!labels.includes('Agent'), `the rail lists ${labels.join(', ')}, not Agent`);
      assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
    } finally {
      await context.close();
    }
  });
}

test('an agentic App lands on its first normal page, not on the Agent page', async () => {
  const info = appInfo(options('agentic'));
  const pageId = info.pages[0].id;
  const { page, seen, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}` });
  try {
    await page.locator('nav.side [data-rail="dashboard"][aria-current="page"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-agent-page]').count(), 0, 'the Agent page is not shown');
    assert.match(page.url(), new RegExp(`#/${pageId}/dashboard$`), 'the address lands on the dashboard section');
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('a deep link to the Agent section falls back to the dashboard, with the page showing and no blank screen', async () => {
  const info = appInfo(options('agentic'));
  const pageId = info.pages[0].id;
  const { page, seen, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}/agent` });
  try {
    await page.locator('nav.side [data-rail="dashboard"][aria-current="page"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-agent-page]').count(), 0, 'the Agent page is not shown');
    assert.match(page.url(), new RegExp(`#/${pageId}/dashboard$`), 'the address falls back to the dashboard');
    assert.ok(await page.locator('main.main [data-page-section], main.main .kpi-v, main.main .hcard').count() > 0, 'the main area has a page, not a blank screen');
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});
