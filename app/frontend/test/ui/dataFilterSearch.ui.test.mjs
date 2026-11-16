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

const launchOf = async (page, made) => {
  await idle(page);
  await page.getByRole('button', { name: 'Get Started' }).click();
  // Get Started on a new form asks whether to save a business profile (REQ-364); these tests run without saving.
  await page.getByRole('button', { name: 'Run without saving' }).click();
  await until(() => made.launches.length === 1, 'the launch was sent once');
  return made.launches[0].params;
};

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

// Read (REQ-363, the column ticks of the old grid): a column Inspire does not read is left out of the run scope, listed under
// Filters in use, and stays left out after a reload.
async function reopenSearch(page) {
  await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
  await idle(page);
  // A reload may restore the Advanced panel open, so each disclosure is opened only when it is closed.
  for (const name of [/Advanced Settings/, /Data Management \(optional\)/]) {
    const toggle = page.getByRole('button', { name });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  }
  await page.getByRole('searchbox', { name: 'Search column names' }).fill('amount');
}

test('Read: unticking a column leaves it out of the run scope, names it under Filters in use, and a reload keeps it unticked', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('amount');
    const read = page.getByRole('checkbox', { name: 'Read amount in orders' });
    await read.waitFor({ timeout: 10000 });
    assert.equal(await read.isChecked(), true, 'every column starts read');
    await read.uncheck();
    await page.locator('[data-left-out-column="orders.amount"]').waitFor({ timeout: 5000 });
    assert.match(await page.locator('[data-columns-left-out]').innerText(), /Columns left out: 1/);
    // Reload before the launch: a sent launch clears the Launch draft.
    await page.reload();
    await reopenSearch(page);
    await page.getByRole('checkbox', { name: 'Read amount in orders' }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('checkbox', { name: 'Read amount in orders' }).isChecked(), false, 'the untick is restored from the draft');
    const params = await launchOf(page, made);
    assert.deepEqual(JSON.parse(params['17_table_scope'])[ORDERS].columns, ['order_id', 'brand'], 'the run scope omits amount');
  } finally {
    await ui.close();
  }
});

test('Read in all tables: one box reads or leaves out a column in every table that has it, and the list follows', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openSearch(page);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('brand');
    const all = page.getByRole('checkbox', { name: 'Read brand in all 2 tables' });
    await all.waitFor({ timeout: 10000 });
    await all.uncheck();
    assert.equal(await page.getByRole('checkbox', { name: 'Read brand in orders' }).isChecked(), false, 'orders leaves brand out');
    assert.equal(await page.getByRole('checkbox', { name: 'Read brand in customers' }).isChecked(), false, 'customers leaves brand out');
    await page.locator('[data-left-out-column="orders.brand"]').waitFor({ timeout: 5000 });
    await page.locator('[data-left-out-column="customers.brand"]').waitFor({ timeout: 5000 });
    await all.check();
    await until(async () => (await page.locator('[data-columns-left-out]').count()) === 0, 're-reading every column clears the list');
  } finally {
    await ui.close();
  }
});

// The search reads at most 40 tables (the same cap as Relationships). A table past the cap is not searched, and the note says how many.
test('a schema of more than 40 tables: the search reads 40 and says how many were not searched; a column in a table past the cap is not found', async () => {
  const names = Array.from({ length: 45 }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
  const columnsByTable = Object.fromEntries(names.map((n, i) => [`main.s.${n}`, [COL('id', 'BIGINT', 1), COL(i === 44 ? 'zz_only' : 'name', 'STRING', 2)]]));
  const ui = await openUi('launch', { ...STATE, tables: { 'main.s': names }, columnsByTable });
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    const note = page.locator('[data-tables-not-searched]');
    await note.waitFor({ timeout: 15000 });
    assert.match(await note.innerText(), /5 tables were not searched.*Pick fewer schemas or tables under Unity Catalog Metadata/);
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('zz_only');
    await page.locator('[data-search-none]').waitFor({ timeout: 15000 });
    await idle(page);
    const read = new Set(made.sqlCalls.filter((c) => c.sql.includes('information_schema.columns'))
      .map((c) => (c.parameters || []).find((p) => p.name === 't')?.value).filter(Boolean));
    assert.equal(read.size, 40, 'exactly 40 tables have their columns read');
  } finally {
    await ui.close();
  }
});
