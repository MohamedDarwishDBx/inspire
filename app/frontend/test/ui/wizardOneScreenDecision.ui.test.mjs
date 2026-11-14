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
    for (const later of ['2. Which movement counts', '3. Currency', '4. Periods and statuses', '5. Turn it off', '6. Target KPI', '7. Hold back']) {
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

// Every screen of a path: at most one top-level decision is on screen, and Next (or the Measure Next) moves on until Review & build.
const topDecisions = (page) => page.locator('[data-wizard-body] [data-choice]').evaluateAll((els) => els
  .filter((e) => e.getClientRects().length > 0 && !e.parentElement.closest('[data-choice]'))
  .map((e) => e.getAttribute('data-choice')));
const stepName = (page) => page.locator('[aria-current="step"]').innerText();

test('every screen of the default path shows at most one decision, and Next alone reaches Review & build', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    const seen = [];
    for (let i = 0; i < 40; i += 1) {
      const name = (await stepName(page)).trim();
      if (name.includes('Review & build')) break;
      const decisions = await topDecisions(page);
      seen.push(`${name}:${decisions.join('+') || '-'}`);
      assert.ok(decisions.length <= 1, `${name} shows ${decisions.length} decisions at once: ${decisions.join(', ')} (must-exclude)`);
      const money = page.locator('[data-money-next]');
      if (await money.count() && await money.isVisible()) {
        assert.equal(await page.locator('[data-money-current]').count(), 1, `${name}: one Measure decision is current`);
        await money.click();
      } else {
        await page.getByRole('button', { name: 'Next', exact: true }).click({ timeout: 8000 }).catch((e) => { throw new Error(`no Next on ${name}; screens so far: ${seen.join(' | ')}: ${e.message.split('\n')[0]}`); });
      }
    }
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 15000 });
    assert.ok(seen.length >= 5, `the default path has its screens: ${seen.join(' | ')}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
