// REQ-180: the Build wizard's plan refusals for a table whose type cannot be read are one plain named line, never raw JSON. A
// refusal of the pick (metric view, not usable) has no Try again; a type check the workspace could not answer twice has Try again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER, built, builtSpec } from './implementFixtures.js';
import { closeBrowser, goToStep, openAsset, openBuild, openUi, idle } from './uiSupport.mjs';

test.after(closeBrowser);

const PICKED = 'main.s.orders';
const ME = { userName: OWNER, displayName: 'Owner' };
const BUSY = '[HTTP 503] Service Unavailable';
const useCase = { ...HARNESS_USE_CASE, primary_table: PICKED, tables_involved: PICKED };

async function planAlert(ui, text) {
  const { page } = ui;
  await goToStep(page, 'Review & build');
  const alert = page.getByRole('alert').filter({ hasText: text });
  await alert.waitFor({ timeout: 20000 });
  return alert;
}

test('a metric view refused by the plan is one plain line with no Try again and no raw JSON (REQ-180)', async () => {
  const ui = await openUi('wizard', { me: ME, history: [], useCase, metricViews: [PICKED] });
  try {
    const alert = await planAlert(ui, `${PICKED} is a metric view`);
    const text = (await alert.innerText()).trim();
    assert.equal(text.split('\n').filter((line) => /is a metric view/.test(line)).length, 1, `one named line: ${text}`);
    assert.doesNotMatch(text, /[{}]|"error"/, 'no raw JSON');
    assert.equal(await alert.getByRole('button', { name: 'Try again' }).count(), 0, 'a metric view stays wrong until the pick changes');
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});

test('a type check the workspace could not answer twice is one plain line with Try again (REQ-180)', async () => {
  const statements = { 'table_type FROM': () => { throw new Error(`SQL failed (503): ${BUSY}`); } };
  const ui = await openUi('wizard', { me: ME, history: [], useCase, statements });
  try {
    const alert = await planAlert(ui, 'Inspire could not check the type of main.s.orders right now');
    const text = (await alert.innerText()).trim();
    assert.equal(text.split('\n').filter((line) => /could not check the type/.test(line)).length, 1, `one named line: ${text}`);
    assert.doesNotMatch(text, /[{}]|"error"|is not usable/, 'no raw JSON and not shown as a verdict on the table');
    assert.equal(await alert.getByRole('button', { name: 'Try again' }).count(), 1, 'a busy check can be run again');
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});

// REQ-180 (busy, not unusable): a table whose type check the workspace could not answer twice is shown busy, with Try again, and is
// never shown as not usable. A swap candidate in the same state is listed as busy, and the picker's Try again checks it again.
const BUSY_LINE = /Inspire could not check this table's type right now/;
const ORDERS = 'main.s.orders';
const LITE = 'main.s.orders_lite';
const SWAPS = [{ table_catalog: 'main', table_schema: 's', table_name: 'orders_v2', matched: '4', total: '4' },
  { table_catalog: 'main', table_schema: 's', table_name: 'orders_lite', matched: '3', total: '4' }];
const COLUMNS = {
  'main.s.orders': [['order_id', 'STRING'], ['customer_id', 'STRING'], ['order_date', 'DATE'], ['amount', 'DECIMAL(10,2)']],
  'main.s.orders_v2': [['order_id', 'STRING'], ['customer_id', 'STRING'], ['order_date', 'DATE'], ['amount', 'DECIMAL(10,2)'], ['channel', 'STRING']],
  'main.s.orders_lite': [['order_id', 'STRING'], ['customer_id', 'STRING'], ['order_date', 'DATE']],
};
const columnRows = Object.fromEntries(Object.entries(COLUMNS).map(([t, pairs]) => [t, pairs.map(([column_name, data_type], i) => ({ column_name, data_type, ordinal_position: i + 1 }))]));
const SWAP_TYPES = { 'table_type FROM': (_sql, parameters) => {
  const name = (parameters || []).find((p) => p.name === 't')?.value;
  if (name === 'orders_lite') throw new Error('SQL failed (503): Service Unavailable');
  return { rows: [{ table_type: 'MANAGED' }] };
} };

test('a swap candidate whose type check is busy is listed busy and cannot be chosen, never as not usable (REQ-180)', async () => {
  const ui = await openBuild({ me: { userName: OWNER, displayName: 'Owner' }, history: [built()], forwardedToken: 'person-token', columnsByTable: columnRows,
    swapRows: SWAPS, statements: SWAP_TYPES, appApi: { 'GET /api/settings': [{ settings: [], history: [], editable: true, why: '', can_run: false }] } });
  const { page } = ui;
  try {
    const tables = (await openAsset(page, 'notebook')).getByRole('region', { name: 'Settings', exact: true }).locator('[data-settings-tables]');
    await tables.locator(`[data-table="${ORDERS}"]`).waitFor({ timeout: 15000 });
    await tables.locator(`[data-table="${ORDERS}"]`).getByRole('button', { name: 'Change', exact: true }).click();
    const pick = tables.getByLabel(`Table to use for ${ORDERS}`);
    const busy = pick.locator('option[data-unusable-option]', { hasText: BUSY_LINE });
    await busy.waitFor({ state: 'attached', timeout: 20000 });
    assert.equal(await busy.getAttribute('disabled'), '', 'the busy candidate cannot be chosen');
    assert.equal(await pick.locator('option', { hasText: `${LITE}: Inspire could not read this table's type` }).count(), 0, 'not shown as not usable');
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});

// The Data Filters picker (the tree of a picked schema): a busy type check is a row with Try again, not a leaf and not not-usable.
const PICKER_TABLE = 'adb_fe_uae_01.demo_telco.customers';
const PICKER_BUSY = "Inspire could not check this table's type right now. Try again.";

test('a picker row whose type check is busy shows Try again, and Try again lists the table once it can be checked (REQ-180)', async () => {
  const ui = await openUi('launch', { catalogs: ['adb_fe_uae_01'], schemas: { adb_fe_uae_01: ['demo_telco'] },
    tables: { 'adb_fe_uae_01.demo_telco': ['customers'] }, forwardedEmail: 'harness.person@example.com',
    busyTables: { [PICKER_TABLE]: PICKER_BUSY } });
  const { page, made } = ui;
  try {
    await page.getByPlaceholder('e.g. Contoso, Acme Corp, Retail Division').fill('Acme');
    await page.locator('button[title="adb_fe_uae_01"]').click();
    await page.locator('button[title="demo_telco"]').click();
    await idle(page);
    // The Launch picker disables a busy table, so the schema is picked and its tables are listed in Data Filters instead.
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Filters \(optional\)/ }).click();
    // The schema is collapsed in the tree until it is opened; opening it lists its tables.
    await page.locator('[data-schema-group] [role="treeitem"]').first().click();
    // The Launch picker lists the same busy table with its own Try again, so this test reads the Data Filters tree only.
    const busy = page.locator(`[data-schema-group] [data-type-check-busy="${PICKER_TABLE}"]`);
    await busy.waitFor({ timeout: 15000 });
    assert.match(await busy.innerText(), /could not check this table's type right now/);
    assert.equal(await page.locator(`[data-unusable-table="${PICKER_TABLE}"]`).count(), 0, 'not shown as not usable');
    assert.equal(await page.locator(`[data-scope-table="${PICKER_TABLE}"]`).count(), 0, 'cannot be picked while busy');
    made.state.busyTables = {};
    await busy.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.locator(`[data-scope-table="${PICKER_TABLE}"]`).waitFor({ timeout: 15000 });
    assert.equal(await page.locator(`[data-schema-group] [data-type-check-busy="${PICKER_TABLE}"]`).count(), 0);
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});

// REQ-180 (plan swap refusal): a metric view swapped in for a picked table is refused by the plan with a 400 that names the table. The
// wizard shows that one plain line: no Try again (the pick must change) and no raw JSON.
const SWAPPED_VIEW = 'main.s.orders_v2';

test('a metric view swapped in for a picked table is refused by the plan as one plain named line, with no Try again (REQ-180)', async () => {
  const swapped = builtSpec();
  swapped.data = { ...swapped.data, tables: { [PICKED]: SWAPPED_VIEW } };
  const ui = await openUi('wizard', { me: ME, history: [built({ spec_json: JSON.stringify(swapped) })], useCase, metricViews: [SWAPPED_VIEW] });
  try {
    const alert = await planAlert(ui, `${SWAPPED_VIEW} is a metric view`);
    const text = (await alert.innerText()).trim();
    assert.equal(text.split('\n').filter((line) => /is a metric view/.test(line)).length, 1, `one named line: ${text}`);
    assert.doesNotMatch(text, /[{}]|"error"/, 'no raw JSON');
    assert.equal(await alert.getByRole('button', { name: 'Try again' }).count(), 0, 'a metric view swapped in stays wrong until the pick changes');
    assert.deepEqual(ui.pageErrors.filter((e) => !/Failed to load resource/.test(e)), [], 'no page exception');
  } finally {
    await ui.close();
  }
});
