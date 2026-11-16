import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-363: Data filter is a column search across every picked table. Typing "brand" lists only the columns whose name contains it.
// A row adds a filter to that one table. A name several tables have offers Apply to all, which filters every one of them at once.
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
const SHOTS = '/private/tmp/inspire_v15/shots/u2';

async function openSearch(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await page.locator('button[title="customers"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await page.getByRole('searchbox', { name: 'Search column names' }).waitFor({ timeout: 15000 });
  await until(async () => (await page.locator('[data-search-hint]').count()) === 1, 'the search hint shows once the columns are read', 15000);
}

test('typing brand lists only the columns whose name contains brand, case-insensitive, each with its table', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('BRAND');
    await page.locator('[data-column-group="brand"]').waitFor({ timeout: 10000 });
    assert.equal(await page.locator('[data-column-group]').count(), 1, 'one column name matches');
    const rows = await page.locator('[data-column-group="brand"] [data-scope-row]').allInnerTexts();
    assert.equal(rows.length, 2, 'both tables have brand');
    assert.match(rows.join('\n'), /orders/);
    assert.match(rows.join('\n'), /customers/);
    const text = await page.locator('[data-column-search]').innerText();
    assert.doesNotMatch(text, /amount|order_id|customer_id/, 'columns without brand are not listed');
  } finally {
    await ui.close();
  }
});

test('Apply to all adds one filter to every table that has the column, and each table filter is removable on its own', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    const group = page.locator('[data-column-group="brand"]');
    await group.waitFor({ timeout: 10000 });
    await group.getByRole('button', { name: /Apply to all/ }).click();
    await page.getByLabel('Value for brand in 2 tables').fill('Acme');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Apply to all tables' }).click();
    const inUse = page.locator('[data-filters-in-use]');
    await inUse.locator(`[data-filter-table="${ORDERS}"] [data-scope-condition="brand"]`).waitFor({ timeout: 5000 });
    await inUse.locator(`[data-filter-table="${CUSTOMERS}"] [data-scope-condition="brand"]`).waitFor({ timeout: 5000 });
    assert.match(await inUse.innerText(), /brand: is Acme/);
    await page.getByRole('button', { name: 'Remove row filter on brand in orders: is Acme' }).click();
    assert.equal(await inUse.locator(`[data-filter-table="${ORDERS}"] [data-scope-condition="brand"]`).count(), 0, 'orders filter removed');
    assert.equal(await inUse.locator(`[data-filter-table="${CUSTOMERS}"] [data-scope-condition="brand"]`).count(), 1, 'customers keeps its own filter');
    await until(() => made.sqlCalls.some((c) => /GROUP BY|COUNT\(\*\)/.test(c.sql) || c.sql.includes('row_count')), 'the rows are counted', 10000).catch(() => null);
  } finally {
    await ui.close();
  }
});

test('a row adds a filter to just that table, and the empty states say what to do', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    const search = page.getByRole('searchbox', { name: 'Search column names' });
    await search.fill('zzz');
    assert.match(await page.locator('[data-search-none]').innerText(), /No column name contains "zzz" in the 2 tables you picked/);
    await search.fill('name');
    await page.locator('[data-column-group="name"]').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Add row filter on name in customers' }).click();
    await page.getByLabel('Value for name in customers').fill('Ada');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Add filter' }).click();
    await page.locator(`[data-filter-table="${CUSTOMERS}"] [data-scope-condition="name"]`).waitFor({ timeout: 5000 });
    assert.equal(await page.locator(`[data-filter-table="${ORDERS}"]`).count(), 0, 'orders gets no filter');
    await search.fill('');
    assert.match(await page.locator('[data-search-hint]').innerText(), /Type a column name to find it in the 2 tables you picked/);
  } finally {
    await ui.close();
  }
});

test('the column search fits 1280x800 with filters in use, and the picture is saved for review', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    const search = page.getByRole('searchbox', { name: 'Search column names' });
    await search.fill('brand');
    await page.locator('[data-column-group="brand"]').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /Apply to all/ }).click();
    await page.getByLabel('Value for brand in 2 tables').fill('Acme');
    await page.getByRole('button', { name: 'Add value' }).click();
    await page.getByRole('button', { name: 'Apply to all tables' }).click();
    await page.locator('[data-filters-in-use]').waitFor({ timeout: 5000 });
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `no sideways scroll at ${width}x${height} (overflow ${sideways}px)`);
      await page.locator('[data-data-management]').screenshot({ path: `${SHOTS}/req363-data-filter-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});
