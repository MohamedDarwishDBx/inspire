import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-361: the step is named Data Management and holds two sections in order: Relationships, then Data filter. Fits 1280x800 with no sideways scroll.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: {
    [ORDERS]: [{ column_name: 'order_id', data_type: 'BIGINT', ordinal_position: 1 }, { column_name: 'brand', data_type: 'STRING', ordinal_position: 2 }],
  },
};
const SHOTS = '/private/tmp/inspire_v15/shots/u2';

test('Data Management holds Relationships then Data filter, and no Data Filters name is shown; it fits 1280x800 without sideways scroll', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.locator('[data-data-management]').waitFor({ timeout: 15000 });
    const headings = await page.locator('[data-data-management] h3').allInnerTexts();
    assert.deepEqual(headings, ['Relationships', 'Data filter']);
    const top = async (section) => (await page.locator(`[data-section="${section}"]`).boundingBox()).y;
    assert.ok(await top('relationships') < await top('data-filter'), 'Relationships sits above Data filter');
    const panel = await page.locator('[data-data-management]').innerText();
    assert.doesNotMatch(panel, /Data Filters/, 'no person sees the old step name in this panel');
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(sideways <= 0, `no sideways scroll at 1280x800 (overflow ${sideways}px)`);
    await page.locator('[data-data-management]').screenshot({ path: `${SHOTS}/req361-sections-1280x800.png` });
  } finally {
    await ui.close();
  }
});
