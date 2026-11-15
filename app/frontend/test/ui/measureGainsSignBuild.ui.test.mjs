// REQ-265 (D-AUTO close the gains-without-sign risk): Gains only with no sign picked stops the build with a plain reason on Measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onMoneyPart, openUi, profileAt, stubMoney as stub } from './uiSupport.mjs';
import { MONEY_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const REASON = /Gains only needs a sign: name the column whose positive values are gains/;

test('REQ-265: Gains only with no sign stops the build, names the reason in plain words, and clears once a sign is named (must-exclude: a build with no sign)', async () => {
  const ui = await openUi('wizard', ME, '', {
    init: async (page) => {
      await profileAt([], MONEY_PROFILE)(page);
      await stub('value-preview', () => ({ rows: [{ stake: 100, currency: 'AED' }] }), [])(page);
      await stub('currency-rates', () => ({ base: 'AED', currencies: [{ code: 'AED', records: 1 }], rates: {}, sources: {}, missing: [], offline: false, message: '' }), [])(page);
    },
  });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await onMoneyPart(page, 'direction');
    await page.locator('input[name="measure-direction"][data-money-rule-kind="gains"]').check({ force: true });
    await page.locator('[data-money-next]').click();
    await onMoneyPart(page, 'sign');
    // Walk the Measure decisions to the end, then press the step's Next: the step refuses to go on and names the reason.
    for (let i = 0; i < 10 && await page.locator('[data-money-next]').count(); i += 1) await page.locator('[data-money-next]').first().click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText(REASON).first().waitFor({ timeout: 15000 });
    assert.equal(await page.getByText(REASON).first().isVisible(), true, 'the build refuses with the plain reason on screen');
    assert.equal(await page.locator('[data-build-now]').isDisabled(), true, 'the build button is off while the sign is missing (must-exclude)');
    await onMoneyPart(page, 'sign');
    await page.locator('[data-money-sign-kind="status"]').check();
    await page.locator('[data-money-sign-status-column]').fill('channel');
    await page.locator('[data-money-sign-value]').fill('gain');
    await page.waitForFunction(() => !document.querySelector('[data-money-sign-needed]'), null, { timeout: 15000 });
    assert.equal(await page.getByText(REASON).count(), 0, 'the reason clears once a sign is named');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
