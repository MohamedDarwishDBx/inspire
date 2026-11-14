import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_IT, closeBrowser, goToStep, openUi, stubMoney, toSummary } from './uiSupport.mjs';

// REQ-001: one decision per wizard screen. A later Measure decision is not on screen until Next reaches it.
test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const stubPreview = (page) => stubMoney('value-preview', () => ({ rows: [{ stake: 1, currency: 'USD' }] }), [])(page);
const body = (page) => page.locator('[data-wizard-body]');

test('Measure shows its first decision alone: the later decision titles are not on the screen (must-exclude)', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-part="method"]').waitFor();
    const text = await body(page).innerText();
    for (const later of ['2. Which movement counts', '3. Currency', '4. Periods and statuses', '5. Turn it off', '6. Measure impact']) {
      assert.equal(text.includes(later), false, `"${later}" is not on the Measure screen before Next reaches it`);
    }
    assert.ok(text.includes('1. How the value is measured'), 'the first decision is the one on screen');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a default path reaches Review & build with Next only, and All Good, Build it Now is on', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await toSummary(page);
    // Review & build has its own Build button (All Good, Build it Now), enabled once every step is valid.
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled),
      BUILD_IT, { timeout: 15000 });
    assert.equal(await page.getByRole('button', { name: BUILD_IT, exact: true }).count(), 1, 'the Build button is on Review & build');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
