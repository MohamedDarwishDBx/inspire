import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';
import { START_DRAFT_PREFIX } from '../../src/lib/wizardDraft.js';

test.after(closeBrowser);

// REQ-362: Data Management > Relationships. Picked tables are joined by their declared keys, then by matching column names. The person
// keeps, changes, removes and adds relationships; the list is kept in the Launch draft.
const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'main.s.orders';
const CUSTOMERS = 'main.s.customers';
const DECLARED = 'orders.customer_id → customers.customer_id';
const DENIED = "[PERMISSION_DENIED] User does not have USE SCHEMA on Schema 'main.s'.";
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
const SHOTS = '/private/tmp/inspire_v15/shots/u2';

async function openRelationships(page, { reload = false } = {}) {
  if (reload) {
    await page.reload();
    await page.getByPlaceholder(BUSINESS).waitFor({ timeout: 20000 });
    await idle(page);
  } else {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await page.locator('button[title="customers"]').click();
    await idle(page);
  }
  await page.getByRole('button', { name: /Advanced Settings/ }).click();
  await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
  await page.getByLabel('Table to see relationships for').selectOption(ORDERS);
  await idle(page);
}

test('Relationships lists the declared key of orders as a suggestion, with its source, and Add keeps it', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    const suggestion = page.locator(`[data-suggested-relationship="${DECLARED}"]`);
    await suggestion.waitFor({ timeout: 15000 });
    assert.match(await suggestion.innerText(), /declared key/);
    await page.getByRole('button', { name: `Add suggested relationship ${DECLARED}` }).click();
    await page.locator(`[data-relationship="${DECLARED}"]`).waitFor({ timeout: 5000 });
    assert.equal(await page.locator(`[data-suggested-relationship="${DECLARED}"]`).count(), 0, 'an added relationship is no longer a suggestion');
  } finally {
    await ui.close();
  }
});

test('a name match is suggested with its source, and a relationship can be removed and is suggested again', async () => {
  const ui = await openUi('launch', { ...STATE, statements: {} });
  const { page } = ui;
  try {
    await openRelationships(page);
    const suggestion = page.locator('[data-suggested-relationship="orders.customer_id → customers.customer_id"]');
    await suggestion.waitFor({ timeout: 15000 });
    assert.match(await suggestion.innerText(), /matching column name/);
    await page.getByRole('button', { name: `Add suggested relationship ${DECLARED}` }).click();
    await page.getByRole('button', { name: `Remove relationship ${DECLARED}` }).click();
    assert.equal(await page.locator(`[data-relationship="${DECLARED}"]`).count(), 0, 'removed');
    assert.equal(await page.locator(`[data-suggested-relationship="${DECLARED}"]`).count(), 1, 'suggested again');
  } finally {
    await ui.close();
  }
});

test('an added relationship can change its column on either side, and a manual relationship picks a table and a column on each side', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    await page.getByRole('button', { name: `Add suggested relationship ${DECLARED}` }).click();
    await page.getByLabel('Column of customers in this relationship').selectOption('name');
    assert.equal(await page.locator('[data-relationship="orders.customer_id → customers.name"]').count(), 1, 'the edited link stays under orders');
    assert.equal(await page.locator(`[data-relationship="${DECLARED}"]`).count(), 0, 'the old column is gone');
    await page.getByRole('button', { name: 'Add a relationship' }).click();
    await page.getByLabel('Column on the first side').selectOption('amount');
    await page.getByLabel('Table on the second side').selectOption(CUSTOMERS);
    await page.getByLabel('Column on the second side').selectOption('name');
    await page.getByRole('button', { name: 'Add relationship' }).click();
    const manual = page.locator('[data-relationship="orders.amount → customers.name"]');
    await manual.waitFor({ timeout: 5000 });
    assert.match(await manual.innerText(), /added by you/);
  } finally {
    await ui.close();
  }
});

test('the relationships are kept in the Launch draft and are there after a reload', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    await page.getByRole('button', { name: `Add suggested relationship ${DECLARED}` }).click();
    await until(async () => (await page.evaluate(([prefix]) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith(prefix));
      return key && JSON.parse(localStorage.getItem(key)).spec.relationships?.length === 1;
    }, [START_DRAFT_PREFIX])), 'the draft holds the kept relationship', 10000);
    await openRelationships(page, { reload: true });
    await page.locator(`[data-relationship="${DECLARED}"]`).waitFor({ timeout: 15000 });
  } finally {
    await ui.close();
  }
});

test('a relationship read refused for the signed-in person opens Permission Required once', async () => {
  const ui = await openUi('launch', { ...STATE, forwardedEmail: 'harness.person@example.com', statements: { 'AS ref_table': () => { throw new Error(DENIED); } } });
  const { page } = ui;
  try {
    await openRelationships(page);
    await page.locator('[data-permission-dialog=""]').waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-permission-dialog=""]').count(), 1, 'exactly one Permission Required dialog');
  } finally {
    await ui.close();
  }
});

test('Relationships fits 1280x800 with a kept relationship, and the picture is saved for review', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await openRelationships(page);
    await page.getByRole('button', { name: `Add suggested relationship ${DECLARED}` }).click();
    await page.locator('[data-relationships]').waitFor({ timeout: 15000 });
    for (const [width, height] of [[1440, 900], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(sideways <= 0, `no sideways scroll at ${width}x${height} (overflow ${sideways}px)`);
      await page.locator('[data-data-management]').screenshot({ path: `${SHOTS}/req362-relationships-${width}x${height}.png` });
    }
  } finally {
    await ui.close();
  }
});

test('a schema picked whole: Relationships works on every table of the schema, the same list the Data filter search reads', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    const options = await page.getByLabel('Table to see relationships for').locator('option').allInnerTexts();
    assert.deepEqual(options.sort(), [CUSTOMERS, ORDERS].sort(), 'both tables of the picked schema are offered');
    await page.getByLabel('Table to see relationships for').selectOption(ORDERS);
    await page.locator(`[data-suggested-relationship="${DECLARED}"]`).waitFor({ timeout: 15000 });
  } finally {
    await ui.close();
  }
});
