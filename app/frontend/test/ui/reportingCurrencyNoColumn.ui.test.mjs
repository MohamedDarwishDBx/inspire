// REQ-103 (screen 9 "Report the amounts"): a use case table with no currency column still offers the reporting-currency choice.
// Its amounts are in the one code the value is written in, and the rate of that code to the reporting currency is read (today's by default).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onMoneyPart, openUi, profileAt, stubMoney as stub } from './uiSupport.mjs';
import { GROUPING_PROFILE, MONEY_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
// The walk's table: no currency column; the value is USD.
const NO_CURRENCY_PROFILE = { ...MONEY_PROFILE, money_columns: ['order_id', 'quantity', 'unit_price', 'discount', 'amount', 'status'],
  money_sample: { amount: 'amount', currency: '', status: '', rows: [{ amount: 100 }, { amount: 50 }] } };
const TODAY_RATE = { base: 'AED', currencies: [{ code: 'USD', records: null }], rates: { USD: 0.272294 }, sources: { USD: 'today' }, missing: [], as_of: '2026-11-15', offline: false, message: '' };

test('REQ-103: with no currency column the Currency screen offers Convert, and the rate of the value code to the reporting currency is read (must not be hidden)', async () => {
  const calls = { currency: [] };
  const ui = await openUi('wizard', ME, '', {
    init: async (page) => {
      await profileAt([], NO_CURRENCY_PROFILE)(page);
      await stub('currency-rates', () => TODAY_RATE, calls.currency)(page);
      await stub('value-preview', () => ({ rows: [{ stake: 100, currency: 'USD' }] }), [])(page);
    },
  });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await onMoneyPart(page, 'currency');
    assert.equal(await page.locator('[data-money-currency-mode="convert"]').count(), 1, 'the reporting-currency choice is on screen (fail-pre: it was hidden with no currency column)');
    await page.locator('[data-money-currency-mode="convert"]').check({ force: true });
    await page.locator('[data-money-base]').fill('AED');
    await page.locator('[data-money-base]').blur();
    await page.waitForFunction(() => document.querySelector('[data-money-rate-row="USD"]'), null, { timeout: 15000 });
    // The rates are read on open (in the saved base, none yet) and again for the reporting currency typed; every read names the value code only.
    assert.deepEqual(calls.currency.map((c) => [c.codes, c.currency_column ?? '']), calls.currency.map(() => [['USD'], '']),
      'every rate read names the one code the value is written in, and no currency column (no table read for the codes)');
    assert.equal(calls.currency.at(-1).base, 'AED', 'the rate is read to the reporting currency asked for');
    assert.equal(await page.locator('[data-money-rate-row="USD"] [data-money-rate]').inputValue(), '0.272294', 'the rate table shows the USD rate of today');
    assert.equal(await page.locator('[data-money-rate-row="USD"] [data-money-rate-source]').getAttribute('data-money-rate-source'), 'today');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
