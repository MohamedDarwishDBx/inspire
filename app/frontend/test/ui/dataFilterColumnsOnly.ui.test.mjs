import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-383: the Data filter section is about columns only. It holds the column search, the column rows (name, its table in small text,
// Read, Row filter, Load groups, Apply to all), Your filters (N) and Columns left out (N). No table, schema or catalog tree, picker or
// per-table block is shown in it.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const CUSTOMERS = 'main.s.customers';
const COL = (name, type, n) => ({ column_name: name, data_type: type, ordinal_position: n });
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: {
    [ORDERS]: [COL('order_id', 'BIGINT', 1), COL('brand', 'STRING', 2), COL('amount', 'DECIMAL(12,2)', 3)],
    [CUSTOMERS]: [COL('customer_id', 'BIGINT', 1), COL('brand', 'STRING', 2), COL('name', 'STRING', 3)],
  },
  readinessRows: [{ row_count: '1200' }],
};
const SHOTS_U7 = '/private/tmp/inspire_v15/shots/u7';
const TREE_TITLES = ['main', 's', 'orders', 'customers', 'main.s'];

async function openFilter(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await page.locator('button[title="customers"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await page.getByRole('searchbox', { name: 'Search column names' }).waitFor({ timeout: 15000 });
}

test('REQ-383: the Data filter section shows no table, schema or catalog tree, picker or table name before a search', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openFilter(page);
    const section = page.locator('[data-section="data-filter"]');
    assert.equal(await section.locator('button[title]').count(), 0, 'no tree or picker button is in the section');
    for (const title of TREE_TITLES) assert.equal(await section.locator(`[title="${title}"]`).count(), 0, `no tree entry for ${title}`);
    const text = await section.innerText();
    assert.doesNotMatch(text, /Pick tables, schemas or catalogs|table picker|read whole/, 'no picker or whole-table line');
    assert.doesNotMatch(text, /orders|customers/, 'no table is named before a search');
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-group="brand"]').waitFor({ timeout: 10000 });
    assert.equal(await section.locator('[data-column-group]').count(), 1, 'the search lists one column name');
    assert.equal(await section.locator('[data-scope-row]').count(), 2, 'one row per table that has the column');
    assert.equal(await section.locator('button[title]').count(), 0, 'the search adds no tree or picker');
    await page.locator('[data-section="data-filter"]').screenshot({ path: `${SHOTS_U7}/req383-search-1280x800.png` }).catch(() => {});
  } finally {
    await ui.close();
  }
});

test('REQ-383: Your filters lists each row filter as one flat row with its table in small text, and no per-table block', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openFilter(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    await page.locator('[data-column-group="brand"]').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Row filter on brand in orders' }).click();
    await page.getByLabel('Value for brand in orders').fill('Acme');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    const inUse = page.locator('[data-filters-in-use]');
    await inUse.locator('[data-scope-condition="brand"]').waitFor({ timeout: 5000 });
    assert.match(await inUse.locator('p').first().innerText(), /^Your filters \(1\)$/);
    assert.equal(await inUse.locator('div[data-filter-table]').count(), 0, 'no per-table block');
    const chip = inUse.locator(`[data-filter-table="${ORDERS}"][data-scope-condition="brand"]`);
    assert.equal(await chip.count(), 1, 'the filter names its table');
    assert.match(await chip.innerText(), /brand: is Acme\s*orders/, 'the table is shown in small text beside the condition');
    const section = page.locator('[data-section="data-filter"]');
    assert.doesNotMatch(await section.innerText(), /needs a fix/, 'no per-table status line');
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `${width}x${height}: no sideways scroll (overflow ${sideways}px)`);
      await section.screenshot({ path: `${SHOTS_U7}/req383-filters-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});
