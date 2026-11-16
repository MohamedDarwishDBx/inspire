import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-362, REQ-371: Data Management > Relationships. Two lists of the picked tables (Source, Target) sit side by side, with a Link button
// between them. Link opens a dialog with the columns of the two tables; the person pairs columns, then Done. The links are listed and removable.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const CUSTOMERS = 'main.s.customers';
const DECLARED = 'orders.customer_id → customers.customer_id';
const KEY = (_sql, parameters) => {
  const t = parameters.find((p) => p.name === 't').value;
  return { rows: t === 'orders' ? [{ column_name: 'customer_id', ref_catalog: 'main', ref_schema: 's', ref_table: 'customers', ref_column: 'customer_id' }] : [] };
};
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders', 'customers'] },
  columnsByTable: {
    [ORDERS]: [{ column_name: 'order_id', data_type: 'BIGINT', ordinal_position: 1 }, { column_name: 'customer_id', data_type: 'BIGINT', ordinal_position: 2 },
      { column_name: 'amount', data_type: 'DECIMAL', ordinal_position: 3 }],
    [CUSTOMERS]: [{ column_name: 'customer_id', data_type: 'BIGINT', ordinal_position: 1 }, { column_name: 'name', data_type: 'STRING', ordinal_position: 2 }],
  },
  statements: { 'AS ref_table': KEY },
  primaryKeys: [],
};
const SHOTS = '/private/tmp/inspire_v15/shots/u4';

async function openRelationships(page) {
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await page.locator('button[title="customers"]').click();
  await idle(page);
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await page.locator('[data-relationships]').waitFor({ timeout: 15000 });
}

const source = (page, name) => page.locator('[data-list="source"]').getByRole('button', { name, exact: true });
const target = (page, name) => page.locator('[data-list="target"]').getByRole('button', { name, exact: true });

test('two lists, Source and Target, sit side by side; Link is disabled with a reason until one table is on each side', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isDisabled(), true);
    assert.match(await page.locator('[data-link-reason]').innerText(), /Pick one source table and one target table/);
    await source(page, 'orders').click();
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isDisabled(), true, 'one side alone is not enough');
    assert.equal(await target(page, 'orders').isDisabled(), true, 'the same table cannot be the target of its own link');
    await target(page, 'customers').click();
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isDisabled(), false);
    const lists = await page.evaluate(() => {
      const a = document.querySelector('[data-list="source"]').getBoundingClientRect();
      const b = document.querySelector('[data-list="target"]').getBoundingClientRect();
      return { sameRow: Math.abs(a.top - b.top) < 40, rightOf: b.left > a.left };
    });
    assert.deepEqual(lists, { sameRow: true, rightOf: true }, 'the two lists sit next to each other');
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `no sideways scroll at ${width}x${height} (overflow ${sideways}px)`);
      await page.locator('[data-relationships]').screenshot({ path: `${SHOTS}/req371-lists-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});

test('Link opens the dialog with the columns of both tables; the pair is added, a declared key is added only by its button, Done lists the links, and a link can be removed', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    await source(page, 'orders').click();
    await target(page, 'customers').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const dialog = page.locator('[data-link-dialog]');
    await dialog.getByRole('list', { name: 'Columns of orders' }).waitFor({ timeout: 15000 });
    await page.setViewportSize({ width: 1280, height: 800 });
    await dialog.screenshot({ path: `${SHOTS}/req371-dialog-1280x800.png` });
    assert.equal(await dialog.getByRole('button', { name: 'Add link', exact: true }).isDisabled(), true);
    assert.match(await dialog.locator('[data-add-link-reason]').innerText(), /Pick one column in each table/);
    await dialog.getByRole('list', { name: 'Columns of orders' }).getByRole('button', { name: 'amount', exact: true }).click();
    await dialog.getByRole('list', { name: 'Columns of customers' }).getByRole('button', { name: 'name', exact: true }).click();
    await dialog.getByRole('button', { name: 'Add link', exact: true }).click();
    assert.equal(await dialog.locator('[data-staged-link="amount → name"]').count(), 0, 'the staged text uses table.column names');
    assert.equal(await dialog.locator('[data-staged-link="orders.amount → customers.name"]').count(), 1, 'the pair waits in the dialog');
    const suggestion = dialog.locator(`[data-suggested-link="${DECLARED}"]`);
    assert.equal(await suggestion.count(), 1, 'the declared key is suggested in the dialog');
    assert.equal(await page.locator(`[data-relationship="${DECLARED}"]`).count(), 0, 'a suggestion is not added without a click');
    await dialog.getByRole('button', { name: `Add suggested link ${DECLARED}` }).click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await page.locator('[data-links]').waitFor({ timeout: 5000 });
    assert.equal(await page.locator(`[data-relationship="${DECLARED}"]`).count(), 1, 'the declared key is listed after Done');
    assert.equal(await page.locator('[data-relationship="orders.amount → customers.name"]').count(), 1, 'the person pair is listed after Done');
    await page.locator('[data-links]').screenshot({ path: `${SHOTS}/req371-links-1280x800.png` }).catch(() => {});
    await page.getByRole('button', { name: `Remove relationship ${DECLARED}` }).click();
    assert.equal(await page.locator(`[data-relationship="${DECLARED}"]`).count(), 0, 'a link can be removed');
    assert.equal(await page.locator('[data-link-dialog]').count(), 0, 'Done closes the dialog');
  } finally {
    await ui.close();
  }
});

test('a relationship read that fails ends with the reason and Try again, not an endless read', async () => {
  const ui = await openUi('launch', { ...STATE, statements: { 'AS ref_table': KEY }, sqlErrors: { 'key_column_usage': '[PERMISSION_DENIED] User does not have USE SCHEMA on Schema main.s.' } });
  const { page } = ui;
  try {
    await openRelationships(page);
    await source(page, 'orders').click();
    await target(page, 'customers').click();
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    const error = page.locator('[data-link-dialog] [role="alert"]');
    await error.waitFor({ timeout: 15000 });
    assert.match(await error.innerText(), /main\.s/, 'the reason names the schema');
    assert.equal(await page.locator('[data-link-loading]').count(), 0, 'the reading line is gone once the read has ended');
    assert.equal(await page.locator('[data-link-dialog]').getByRole('button', { name: 'Try again', exact: true }).count(), 1, 'Try again is offered');
  } finally {
    await ui.close();
  }
});
