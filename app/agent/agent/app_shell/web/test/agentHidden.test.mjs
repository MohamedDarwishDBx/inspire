// REQ-392 / D-NOAGENT (Amr 2026-11-16): the Agent entry is hidden from the left side menu for every experience. The Agent page
// stays on: an agentic App still opens on it, and only a classic (ui) App falls back to the dashboard for a deep link to it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
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

test('an agentic App opens on the Agent page, with no Agent item in the side menu', async () => {
  const info = appInfo(options('agentic'));
  const pageId = info.pages[0].id;
  const { page, seen, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}`, ready: '[data-agent-page]' });
  try {
    await page.locator('[data-agent-page]').waitFor({ timeout: 20000 });
    assert.match(page.url(), new RegExp(`#/${pageId}/agent$`), 'the address lands on the Agent section');
    assert.equal(await page.locator('nav.side [data-rail="agent"]').count(), 0, 'no agent rail item even while the Agent page is open');
    assert.ok(await page.locator('nav.side [data-rail="dashboard"]').count() > 0, 'the other sections are still in the side menu');
    assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no page errors');
  } finally {
    await context.close();
  }
});

test('a classic (ui) App: a deep link to the Agent section falls back to the dashboard, with the page showing and no blank screen', async () => {
  const info = appInfo(options('ui'));
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

// REQ-392: the side menu at the two desk sizes, saved for review (the agentic App opens on its Agent page; the classic App has no Agent page).
const SHOTS = '/private/tmp/inspire_v15/shots/u11';
for (const experience of ['agentic', 'ui']) {
  test(`REQ-392: the side menu of a '${experience}' App has no Agent entry at 1440x900 and 1280x800, and the screenshots are saved`, async () => {
    const info = appInfo(options(experience));
    const pageId = info.pages[0].id;
    const { page, context } = await openApp(browser, served.base, info, { hash: `#/${pageId}`, ready: experience === 'agentic' ? '[data-agent-page]' : undefined });
    try {
      for (const [width, height] of [[1440, 900], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        await page.locator('nav.side [data-rail]').first().waitFor({ timeout: 20000 });
        assert.equal(await page.locator('nav.side [data-rail="agent"]').count(), 0, `no Agent entry at ${width}x${height}`);
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/req392-side-menu-${experience}-${width}x${height}.png` });
      }
    } finally {
      await context.close();
    }
  });
}
