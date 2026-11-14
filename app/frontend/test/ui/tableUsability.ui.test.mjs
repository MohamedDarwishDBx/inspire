import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-180 (fail closed): the launch table picker shows a table whose type cannot be read with its plain reason, and it cannot be
// picked. A listing that left tables out past its cap says so in one line that names the schema and the count.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const REASON = "Inspire could not read this table's type, so it cannot be used here. Pick another table you can read.";
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: { 'main.s.orders': [{ column_name: 'brand_name', data_type: 'STRING', ordinal_position: 1 }] },
};

async function pickSchema(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await idle(page);
}

test('a table whose type cannot be read is shown with its plain reason, and it cannot be picked', async () => {
  const ui = await openUi('launch', { ...STATE, unusableTables: { 'main.s.orders': REASON } });
  const { page } = ui;
  try {
    await pickSchema(page);
    const orders = page.locator('button[title="orders"]');
    await orders.waitFor();
    assert.equal(await orders.isDisabled(), true, 'an unknown-type table cannot be picked');
    assert.match(await orders.innerText(), /could not read this table's type, so it cannot be used here/);
    assert.equal(await page.locator('button[title="customers"]').isDisabled(), false, 'a usable table can still be picked');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a listing that left tables out names the schema and the count in one plain line', async () => {
  const ui = await openUi('launch', { ...STATE, leftOut: { 'main.s': { count: 5, schema: 'main.s' } } });
  const { page } = ui;
  try {
    await pickSchema(page);
    const line = page.locator('[data-tables-left-out]');
    await line.waitFor();
    assert.equal(await line.innerText(),
      '5 tables in main.s were left out of this list: Inspire lists at most 1000 tables from one schema.');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
