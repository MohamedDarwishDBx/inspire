// REQ-414 part B (b): the cross-domain answers of the run show on the answer style's first screen, through the Genie Answer component,
// at 1440x900 and 1280x800. The fixture is the answer-style page of appStylesRender.test.mjs (data_agent on the agent_chat example).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const ANSWERS = [
  { space: 'space-sales', answer: 'Online sales rose 12 percent in the quarter.' },
  { space: 'space-stock', answer: 'Stock cover is 9 days at the two largest sites.' },
];

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`the orchestrator answers draw on the answer style's first screen at ${width}x${height}, with no console errors`, async () => {
    const info = appInfo(DECIDE, 1, { kind: 'data_agent', orchestrator_answers: ANSWERS }, 'examples/agent_chat.json');
    const { page, seen, context } = await openApp(browser, served.base, info, { width, height, hash: `#/${info.pages[0].id}/dashboard` });
    try {
      await page.locator('.page[data-app-style="answer"]').waitFor({ timeout: 20000 });
      const stored = page.locator('[data-stored-answer]');
      await stored.first().waitFor({ timeout: 20000 });
      assert.equal(await stored.count(), ANSWERS.length, 'one stored answer per domain space');
      for (const a of ANSWERS) {
        assert.match(await page.locator(`[data-stored-answer="${a.space}"]`).innerText(), new RegExp(a.answer.slice(0, 20)));
      }
      await page.screenshot({ path: `/tmp/inspire-sl5-scratch/answers-${width}x${height}.png` });
      assert.deepEqual(seen.errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], 'no console errors');
    } finally {
      await context.close();
    }
  });
}
