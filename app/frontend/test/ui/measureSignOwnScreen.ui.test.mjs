// REQ-265 (REQ-001 reopen): Measure shows one decision per screen. The gains sign question ("Which records are gains?")
// is a screen of its own after "Which movement counts?", and only the Gains movement reaches it. Losses and net skip it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, stubMoney } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const stubPreview = (page) => stubMoney('value-preview', () => ({ rows: [{ stake: 1, currency: 'USD' }] }), [])(page);
const parts = (page) => page.locator('[data-money-part]').evaluateAll((els) => els.map((e) => e.dataset.moneyPart));
const count = (page, sel) => page.locator(sel).count();
const visible = (page, sel) => page.locator(sel).evaluateAll((els) => els.some((e) => e.getClientRects().length > 0));

test('REQ-265: losses skips the gains sign screen, and the direction screen holds no sign question (must-exclude)', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-next]').click();
    assert.deepEqual(await parts(page), ['method', 'direction'], 'the movement screen is the one decision on screen');
    assert.equal(await visible(page, '[data-measure-direction]'), true, 'the movement question is on screen');
    assert.equal(await count(page, '[data-measure-sign]'), 0, 'no gains sign question on the movement screen while Losses only is chosen (must-exclude)');
    assert.equal(await count(page, 'input[name="measure-sign"]'), 0, 'no sign radio on the movement screen (must-exclude)');
    await page.locator('[data-money-next]').click();
    assert.deepEqual(await parts(page), ['method', 'direction', 'currency'], 'Next from Losses only goes straight to Currency: the sign screen is skipped');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('REQ-265: Gains only reaches its own sign screen after the movement screen, with no movement question on it (must-exclude)', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-next]').click();
    await page.locator('input[name="measure-direction"][data-money-rule-kind="gains"]').check({ force: true });
    await page.locator('[data-money-next]').click();
    assert.deepEqual(await parts(page), ['method', 'direction', 'sign'], 'the sign screen follows the movement screen');
    assert.equal(await visible(page, '[data-measure-sign]'), true, 'the gains sign question is on its own screen');
    assert.equal(await count(page, '[data-measure-direction]'), 0, 'the movement question is not on the sign screen (must-exclude)');
    assert.equal(await count(page, 'input[name="measure-direction"]'), 0, 'no movement radio on the sign screen (must-exclude)');
    await page.locator('[data-money-next]').click();
    assert.deepEqual(await parts(page), ['method', 'direction', 'sign', 'currency'], 'Next after the sign goes on to Currency');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('REQ-265: Losses and net both skip the sign screen', async () => {
  const ui = await openUi('wizard', ME, '', { init: stubPreview });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.locator('[data-money-next]').click();
    await page.locator('input[name="measure-direction"][data-money-rule-kind="net"]').check({ force: true });
    await page.locator('[data-money-next]').click();
    assert.deepEqual(await parts(page), ['method', 'direction', 'currency'], 'netted skips the sign screen');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
